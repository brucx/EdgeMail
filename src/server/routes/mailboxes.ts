import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, count, sql } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { mailboxes, domains, auditLogs, messageDeliveries } from "../db/schema";
import { generateId } from "../lib/id";
import { requireAuth } from "../middleware/auth";
import { createMailboxSchema, updateMailboxSchema } from "@shared/types";

const mailboxesRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

mailboxesRouter.use("/*", requireAuth);

/**
 * GET /api/mailboxes
 * List all mailboxes, optionally filtered by domain.
 */
mailboxesRouter.get("/", async (c) => {
  const db = c.get("db");
  const domainId = c.req.query("domainId");

  let query = db.select().from(mailboxes).orderBy(mailboxes.createdAt);

  if (domainId) {
    query = query.where(eq(mailboxes.domainId, domainId)) as typeof query;
  }

  const result = await query;
  return c.json({ data: result });
});

/**
 * GET /api/mailboxes/unread-counts
 * Get unread message count per mailbox for a domain.
 * Query params: domainId (required)
 */
mailboxesRouter.get("/unread-counts", async (c) => {
  const db = c.get("db");
  const domainId = c.req.query("domainId");

  if (!domainId) {
    return c.json({ error: "domainId is required" }, 400);
  }

  const result = await db
    .select({
      mailboxId: mailboxes.id,
      address: mailboxes.address,
      unreadCount: count(messageDeliveries.id),
    })
    .from(mailboxes)
    .leftJoin(
      messageDeliveries,
      and(
        eq(messageDeliveries.mailboxId, mailboxes.id),
        eq(messageDeliveries.folder, "inbox"),
        eq(messageDeliveries.isRead, false),
      ),
    )
    .where(eq(mailboxes.domainId, domainId))
    .groupBy(mailboxes.id)
    .orderBy(mailboxes.createdAt);

  return c.json({ data: result });
});

/**
 * POST /api/mailboxes
 * Create a new mailbox.
 */
mailboxesRouter.post(
  "/",
  zValidator("json", createMailboxSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const { address, domainId, displayName, canSend } = c.req.valid("json");

    // Verify domain exists
    const domain = await db
      .select()
      .from(domains)
      .where(eq(domains.id, domainId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }

    // Verify address belongs to domain
    const addressDomain = address.split("@")[1];
    if (addressDomain !== domain.domain) {
      return c.json(
        { error: `Address must belong to domain ${domain.domain}` },
        400,
      );
    }

    // Check for duplicate
    const existing = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.address, address))
      .limit(1)
      .then((rows) => rows[0]);

    if (existing) {
      return c.json({ error: "Mailbox with this address already exists" }, 409);
    }

    const id = generateId();
    await db.insert(mailboxes).values({
      id,
      address,
      domainId,
      displayName,
      canSend: canSend ?? true,
    });

    // Audit log
    await db.insert(auditLogs).values({
      id: generateId(),
      userId: c.get("userId"),
      action: "mailbox.create",
      resourceType: "mailbox",
      resourceId: id,
      details: JSON.stringify({ address, domainId }),
    });

    const created = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, id))
      .limit(1)
      .then((rows) => rows[0]);

    return c.json(
      { data: created, message: "Mailbox created successfully" },
      201,
    );
  },
);

/**
 * PATCH /api/mailboxes/:id
 * Update mailbox settings (displayName, canSend).
 */
mailboxesRouter.patch(
  "/:id",
  zValidator("json", updateMailboxSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const { id } = c.req.param();
    const updates = c.req.valid("json");

    const existing = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, id))
      .limit(1)
      .then((rows) => rows[0]);

    if (!existing) {
      return c.json({ error: "Mailbox not found" }, 404);
    }

    await db
      .update(mailboxes)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(mailboxes.id, id));

    // Audit log
    await db.insert(auditLogs).values({
      id: generateId(),
      userId: c.get("userId"),
      action: "mailbox.update",
      resourceType: "mailbox",
      resourceId: id,
      details: JSON.stringify(updates),
    });

    const updated = await db
      .select()
      .from(mailboxes)
      .where(eq(mailboxes.id, id))
      .limit(1)
      .then((rows) => rows[0]);

    return c.json({ data: updated, message: "Mailbox updated successfully" });
  },
);

/**
 * DELETE /api/mailboxes/:id
 * Delete a mailbox.
 */
mailboxesRouter.delete("/:id", async (c) => {
  const db = c.get("db");
  const { id } = c.req.param();

  const existing = await db
    .select()
    .from(mailboxes)
    .where(eq(mailboxes.id, id))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return c.json({ error: "Mailbox not found" }, 404);
  }

  await db.delete(mailboxes).where(eq(mailboxes.id, id));

  // Audit log
  await db.insert(auditLogs).values({
    id: generateId(),
    userId: c.get("userId"),
    action: "mailbox.delete",
    resourceType: "mailbox",
    resourceId: id,
    details: JSON.stringify({ address: existing.address }),
  });

  return c.json({ message: "Mailbox deleted successfully" });
});

export default mailboxesRouter;
