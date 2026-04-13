import PostalMime from "postal-mime";
import type { Env } from "../env";
import { createDb } from "../db";
import {
  messages,
  messageRecipients,
  messageDeliveries,
  attachments,
  mailboxes,
  aliases,
  aliasTargets,
  groups,
  groupMembers,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id";

/**
 * Handle inbound email from Cloudflare Email Worker.
 *
 * Flow:
 * 1. Read raw email stream
 * 2. Store raw .eml to R2 → raw/{messageId}.eml
 * 3. Parse MIME with postal-mime (headers, body, attachments)
 * 4. Route to mailbox / alias / group based on recipient address
 * 5. Write message, recipients, deliveries to D1
 * 6. Store attachments to R2 → attachments/{messageId}/{attachmentId}/{filename}
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
): Promise<void> {
  const db = createDb(env.DB);
  const messageId = generateId();

  try {
    // 1. Read raw email content
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const rawSize = rawEmail.byteLength;

    console.log(
      `[EdgeMail] Received email from=${message.from} to=${message.to} size=${rawSize}`,
    );

    // 2. Store raw .eml to R2
    const rawKey = `raw/${messageId}.eml`;
    await env.STORAGE.put(rawKey, rawEmail);

    // 3. Parse MIME with postal-mime
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail);

    // 4. Write message to D1
    await db.insert(messages).values({
      id: messageId,
      messageId: parsed.messageId || null,
      fromAddress: parsed.from?.address || message.from,
      fromName: parsed.from?.name || null,
      subject: parsed.subject || null,
      textBody: parsed.text || null,
      htmlBody: parsed.html || null,
      rawKey,
      size: rawSize,
    });

    // 5. Write recipients
    const allRecipients: { address: string; type: "to" | "cc" | "bcc" }[] = [];

    if (parsed.to) {
      for (const r of parsed.to) {
        if (r.address) allRecipients.push({ address: r.address, type: "to" });
      }
    }
    if (parsed.cc) {
      for (const r of parsed.cc) {
        if (r.address) allRecipients.push({ address: r.address, type: "cc" });
      }
    }

    for (const r of allRecipients) {
      await db.insert(messageRecipients).values({
        id: generateId(),
        messageId,
        address: r.address,
        type: r.type,
      });
    }

    // 6. Route to mailbox(es) based on recipient address
    const recipientAddress = message.to.toLowerCase();
    const deliveredMailboxIds = new Set<string>();

    // Try direct mailbox match
    const directMailbox = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.address, recipientAddress))
      .limit(1)
      .then((rows) => rows[0]);

    if (directMailbox) {
      deliveredMailboxIds.add(directMailbox.id);
    }

    // Try alias match → fan out to target mailboxes
    const matchedAlias = await db
      .select()
      .from(aliases)
      .where(eq(aliases.address, recipientAddress))
      .limit(1)
      .then((rows) => rows[0]);

    if (matchedAlias) {
      const targets = await db
        .select({ mailboxId: aliasTargets.targetMailboxId })
        .from(aliasTargets)
        .where(eq(aliasTargets.aliasId, matchedAlias.id));

      for (const t of targets) {
        deliveredMailboxIds.add(t.mailboxId);
      }
    }

    // Try group match → fan out to member mailboxes
    const matchedGroup = await db
      .select()
      .from(groups)
      .where(eq(groups.address, recipientAddress))
      .limit(1)
      .then((rows) => rows[0]);

    if (matchedGroup) {
      const members = await db
        .select({ mailboxId: groupMembers.mailboxId })
        .from(groupMembers)
        .where(eq(groupMembers.groupId, matchedGroup.id));

      for (const m of members) {
        deliveredMailboxIds.add(m.mailboxId);
      }
    }

    // 7. Write deliveries
    for (const mbId of deliveredMailboxIds) {
      await db.insert(messageDeliveries).values({
        id: generateId(),
        messageId,
        mailboxId: mbId,
        folder: "inbox",
        isRead: false,
      });
    }

    // 8. Store attachments to R2
    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments) {
        const attId = generateId();
        const filename = att.filename || "unnamed";
        const r2Key = `attachments/${messageId}/${attId}/${filename}`;

        await env.STORAGE.put(r2Key, att.content);

        await db.insert(attachments).values({
          id: attId,
          messageId,
          filename,
          mimeType: att.mimeType || "application/octet-stream",
          size: att.content.byteLength,
          r2Key,
        });
      }
    }

    if (deliveredMailboxIds.size === 0) {
      console.warn(
        `[EdgeMail] No mailbox found for recipient=${recipientAddress}, message stored but not delivered`,
      );
    } else {
      console.log(
        `[EdgeMail] Delivered to ${deliveredMailboxIds.size} mailbox(es)`,
      );
    }
  } catch (err) {
    console.error(
      `[EdgeMail] Failed to process inbound email messageId=${messageId}:`,
      err,
    );
    throw err;
  }
}
