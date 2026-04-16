import PostalMime from "postal-mime";
import type { Env } from "../env";
import { createDb } from "../db";
import {
  messages,
  messageRecipients,
  messageDeliveries,
  attachments,
  auditLogs,
  mailboxes,
  aliases,
  aliasTargets,
  groups,
  groupMembers,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id";
import { createLogger, generateRequestId } from "../lib/logger";
import { sanitizeHtml } from "../lib/html-sanitize";

/**
 * Attachment limits. Oversized attachments are dropped (with audit log) but
 * the message itself is still delivered — users shouldn't lose the text body
 * because a sender attached a 50MB video.
 */
const MAX_ATTACHMENT_COUNT = 20;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB per file
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB cumulative

/**
 * Handle inbound email from Cloudflare Email Routing.
 *
 * Order of operations (important for recoverability):
 *   1. Read raw stream + upload to R2 as the immutable source of truth.
 *      If the later steps fail, operators can re-process from R2.
 *   2. Parse MIME (in-memory).
 *   3. Resolve routing (mailbox / alias / group).
 *   4. Write message + recipients + deliveries atomically via `db.batch`.
 *   5. Upload attachments one-by-one; each failure is isolated and audited.
 *
 * HTML bodies are sanitized before storage so the read path never renders
 * attacker-controlled script. The raw .eml in R2 keeps the original bytes.
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const db = createDb(env.DB);
  const messageId = generateId();
  const log = createLogger({
    component: "email-inbound",
    requestId: generateRequestId(),
    messageId,
    from: message.from,
    to: message.to,
  });

  // ── 1. Raw → R2 ──────────────────────────────────────────────────────────
  const rawEmail = await new Response(message.raw).arrayBuffer();
  const rawSize = rawEmail.byteLength;
  const rawKey = `raw/${messageId}.eml`;

  log.info("received", { size: rawSize });

  try {
    await env.STORAGE.put(rawKey, rawEmail);
  } catch (err) {
    log.error("failed to upload raw email to R2", { err });
    // Without the raw bytes we have nothing durable; re-throw so Cloudflare
    // Email Routing can retry.
    throw err;
  }

  // ── 2. Parse MIME ────────────────────────────────────────────────────────
  let parsed: Awaited<ReturnType<InstanceType<typeof PostalMime>["parse"]>>;
  try {
    parsed = await new PostalMime().parse(rawEmail);
  } catch (err) {
    log.error("MIME parse failed", { err });
    throw err;
  }

  const sanitizedHtml = await sanitizeHtml(parsed.html ?? null);

  // ── 3. Resolve routing ──────────────────────────────────────────────────
  const recipientAddress = message.to.toLowerCase();
  const deliveredMailboxIds = new Set<string>();

  const direct = await db
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(eq(mailboxes.address, recipientAddress))
    .limit(1)
    .then((r) => r[0]);
  if (direct) deliveredMailboxIds.add(direct.id);

  const alias = await db
    .select({ id: aliases.id })
    .from(aliases)
    .where(eq(aliases.address, recipientAddress))
    .limit(1)
    .then((r) => r[0]);
  if (alias) {
    const targets = await db
      .select({ mailboxId: aliasTargets.targetMailboxId })
      .from(aliasTargets)
      .where(eq(aliasTargets.aliasId, alias.id));
    for (const t of targets) deliveredMailboxIds.add(t.mailboxId);
  }

  const group = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.address, recipientAddress))
    .limit(1)
    .then((r) => r[0]);
  if (group) {
    const members = await db
      .select({ mailboxId: groupMembers.mailboxId })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, group.id));
    for (const m of members) deliveredMailboxIds.add(m.mailboxId);
  }

  // ── 4. Build core DB writes (message + recipients + deliveries) ────────
  const recipientRows: Array<{
    id: string;
    messageId: string;
    address: string;
    type: "to" | "cc";
  }> = [];
  for (const r of parsed.to ?? []) {
    if (r.address)
      recipientRows.push({
        id: generateId(),
        messageId,
        address: r.address,
        type: "to",
      });
  }
  for (const r of parsed.cc ?? []) {
    if (r.address)
      recipientRows.push({
        id: generateId(),
        messageId,
        address: r.address,
        type: "cc",
      });
  }

  const deliveryRows = Array.from(deliveredMailboxIds).map((mailboxId) => ({
    id: generateId(),
    messageId,
    mailboxId,
    folder: "inbox" as const,
    isRead: false,
  }));

  // d1.batch keeps the message/recipients/deliveries writes atomic. If any
  // statement fails, none commit.
  const stmts = [
    db.insert(messages).values({
      id: messageId,
      messageId: parsed.messageId || null,
      fromAddress: parsed.from?.address || message.from,
      fromName: parsed.from?.name || null,
      subject: parsed.subject || null,
      textBody: parsed.text || null,
      htmlBody: sanitizedHtml,
      rawKey,
      size: rawSize,
    }),
    ...recipientRows.map((row) => db.insert(messageRecipients).values(row)),
    ...deliveryRows.map((row) => db.insert(messageDeliveries).values(row)),
  ];

  try {
    // drizzle types require at least one statement; we always have ≥1.
    await db.batch(stmts as unknown as [typeof stmts[number], ...typeof stmts]);
  } catch (err) {
    log.error("D1 batch write failed", {
      err,
      recipientCount: recipientRows.length,
      deliveryCount: deliveryRows.length,
    });
    // R2 raw object stays — operators can replay.
    throw err;
  }

  if (deliveredMailboxIds.size === 0) {
    log.warn("no mailbox matched recipient; message stored but undelivered");
  } else {
    log.info("delivered", { mailboxCount: deliveredMailboxIds.size });
  }

  // ── 5. Attachments (best-effort, size-limited, per-file isolated) ──────
  const incoming = parsed.attachments ?? [];
  if (incoming.length > MAX_ATTACHMENT_COUNT) {
    log.warn("attachment count exceeds limit; extras dropped", {
      count: incoming.length,
      limit: MAX_ATTACHMENT_COUNT,
    });
    await auditAttachmentDrop(db, messageId, "count_limit", {
      received: incoming.length,
      limit: MAX_ATTACHMENT_COUNT,
    });
  }

  let runningTotal = 0;
  const toProcess = incoming.slice(0, MAX_ATTACHMENT_COUNT);

  for (const att of toProcess) {
    // att.content can be string | ArrayBuffer | Uint8Array depending on
    // encoding. Normalize to a byte length.
    const size =
      typeof att.content === "string"
        ? new TextEncoder().encode(att.content).byteLength
        : (att.content?.byteLength ?? 0);

    if (size > MAX_ATTACHMENT_BYTES) {
      log.warn("attachment exceeds per-file size limit; dropped", {
        filename: att.filename,
        size,
        limit: MAX_ATTACHMENT_BYTES,
      });
      await auditAttachmentDrop(db, messageId, "size_limit", {
        filename: att.filename ?? null,
        size,
      });
      continue;
    }

    if (runningTotal + size > MAX_TOTAL_ATTACHMENT_BYTES) {
      log.warn("cumulative attachment size limit hit; remainder dropped", {
        runningTotal,
        thisSize: size,
      });
      await auditAttachmentDrop(db, messageId, "total_limit", {
        runningTotal,
        thisSize: size,
      });
      break;
    }

    const attId = generateId();
    const filename = att.filename || "unnamed";
    const r2Key = `attachments/${messageId}/${attId}/${filename}`;

    try {
      await env.STORAGE.put(r2Key, att.content);
      await db.insert(attachments).values({
        id: attId,
        messageId,
        filename,
        mimeType: att.mimeType || "application/octet-stream",
        size,
        r2Key,
      });
      runningTotal += size;
    } catch (err) {
      log.error("attachment upload failed; skipping", { filename, err });
      await auditAttachmentDrop(db, messageId, "upload_failed", {
        filename,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function auditAttachmentDrop(
  db: ReturnType<typeof createDb>,
  messageId: string,
  reason: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: generateId(),
      userId: null,
      action: "attachment.dropped",
      resourceType: "message",
      resourceId: messageId,
      details: JSON.stringify({ reason, ...details }),
    });
  } catch {
    // Audit failures must never break delivery.
  }
}
