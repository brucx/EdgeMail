import { and, isNull, lt, eq } from "drizzle-orm";
import type { Env } from "../env";
import { createDb } from "../db";
import {
  messages,
  attachments,
  messageDeliveries,
  messageRecipients,
  auditLogs,
} from "../db/schema";
import { createLogger, generateRequestId } from "../lib/logger";
import { generateId } from "../lib/id";

/**
 * Retention sweep (runs on cron):
 *   1. Soft-delete messages older than RETENTION_SOFT_DELETE_DAYS
 *      by setting `deleted_at`. UI filters these out.
 *   2. Hard-delete messages older than RETENTION_HARD_DELETE_DAYS —
 *      remove the R2 blobs (raw + attachments), then delete the D1 rows
 *      (deliveries / recipients / attachments cascade via FK).
 *
 * Both thresholds are configurable via env; defaults are 180 / 210 days.
 * Work is batched (HARD_BATCH) to stay safely under Worker CPU limits.
 */

const DEFAULT_SOFT_DAYS = 180;
const DEFAULT_HARD_DAYS = 210;
const HARD_BATCH = 50;

export async function runRetention(env: Env): Promise<void> {
  const log = createLogger({
    component: "retention",
    requestId: generateRequestId(),
  });
  const db = createDb(env.DB);

  const softDays = parseIntOrDefault(
    env.RETENTION_SOFT_DELETE_DAYS,
    DEFAULT_SOFT_DAYS,
  );
  const hardDays = parseIntOrDefault(
    env.RETENTION_HARD_DELETE_DAYS,
    DEFAULT_HARD_DAYS,
  );

  const softCutoff = new Date(Date.now() - softDays * 86_400_000).toISOString();
  const hardCutoff = new Date(Date.now() - hardDays * 86_400_000).toISOString();

  log.info("retention starting", { softDays, hardDays, softCutoff, hardCutoff });

  // ── Phase 1: Soft delete ─────────────────────────────────────────────
  const softResult = await db
    .update(messages)
    .set({ deletedAt: new Date().toISOString() })
    .where(and(isNull(messages.deletedAt), lt(messages.createdAt, softCutoff)))
    .returning({ id: messages.id });

  log.info("soft-deleted", { count: softResult.length });

  // ── Phase 2: Hard delete (in batches) ────────────────────────────────
  const toHardDelete = await db
    .select({ id: messages.id, rawKey: messages.rawKey })
    .from(messages)
    .where(lt(messages.createdAt, hardCutoff))
    .limit(HARD_BATCH);

  if (toHardDelete.length === 0) {
    log.info("retention complete", { hardDeleted: 0 });
    await recordAudit(db, "retention.run", { soft: softResult.length, hard: 0 });
    return;
  }

  let r2Deleted = 0;
  let r2Failed = 0;

  for (const msg of toHardDelete) {
    // Fetch attachments first so we know every R2 key associated with the
    // message. We collect then issue batched R2 deletes.
    const atts = await db
      .select({ r2Key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.messageId, msg.id));

    const keys: string[] = [];
    if (msg.rawKey) keys.push(msg.rawKey);
    for (const a of atts) keys.push(a.r2Key);

    if (keys.length > 0) {
      try {
        await env.STORAGE.delete(keys);
        r2Deleted += keys.length;
      } catch (err) {
        r2Failed += keys.length;
        log.warn("R2 delete failed; continuing to D1 delete", {
          messageId: msg.id,
          err,
        });
      }
    }

    // Delete D1 rows. FKs with ON DELETE CASCADE handle recipients,
    // deliveries, and attachments — but we're explicit here for clarity
    // and because a future schema change shouldn't silently skip cleanup.
    await db
      .delete(attachments)
      .where(eq(attachments.messageId, msg.id));
    await db
      .delete(messageDeliveries)
      .where(eq(messageDeliveries.messageId, msg.id));
    await db
      .delete(messageRecipients)
      .where(eq(messageRecipients.messageId, msg.id));
    await db.delete(messages).where(eq(messages.id, msg.id));
  }

  log.info("retention complete", {
    softDeleted: softResult.length,
    hardDeleted: toHardDelete.length,
    r2Deleted,
    r2Failed,
  });

  await recordAudit(db, "retention.run", {
    soft: softResult.length,
    hard: toHardDelete.length,
    r2Deleted,
    r2Failed,
  });
}

async function recordAudit(
  db: ReturnType<typeof createDb>,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: generateId(),
      userId: null,
      action,
      resourceType: "system",
      resourceId: null,
      details: JSON.stringify(details),
    });
  } catch {
    // non-critical
  }
}

function parseIntOrDefault(s: string | undefined, d: number): number {
  if (!s) return d;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}
