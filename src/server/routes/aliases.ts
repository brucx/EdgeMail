import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import {
  aliases,
  aliasTargets,
  domains,
  mailboxes,
  auditLogs,
} from "../db/schema";
import { generateId } from "../lib/id";
import { requireAuth } from "../middleware/auth";
import { createAliasSchema, updateAliasSchema } from "@shared/types";

const aliasesRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

aliasesRouter.use("/*", requireAuth);

/**
 * Helper: load alias with its target mailboxes.
 */
async function loadAliasWithTargets(
  db: ReturnType<typeof import("../db").createDb>,
  aliasId: string,
) {
  const alias = await db
    .select()
    .from(aliases)
    .where(eq(aliases.id, aliasId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!alias) return null;

  const targets = await db
    .select({
      id: mailboxes.id,
      address: mailboxes.address,
      displayName: mailboxes.displayName,
      domainId: mailboxes.domainId,
      canSend: mailboxes.canSend,
      createdAt: mailboxes.createdAt,
    })
    .from(aliasTargets)
    .innerJoin(mailboxes, eq(aliasTargets.targetMailboxId, mailboxes.id))
    .where(eq(aliasTargets.aliasId, aliasId));

  return { ...alias, targets };
}

/**
 * GET /api/aliases
 * List all aliases with their targets.
 */
aliasesRouter.get("/", async (c) => {
  const db = c.get("db");
  const domainId = c.req.query("domainId");

  const query = domainId
    ? db.select().from(aliases).where(eq(aliases.domainId, domainId)).orderBy(aliases.createdAt)
    : db.select().from(aliases).orderBy(aliases.createdAt);

  const allAliases = await query;

  // Load targets for each alias
  const result = await Promise.all(
    allAliases.map(async (alias) => {
      const targets = await db
        .select({
          id: mailboxes.id,
          address: mailboxes.address,
          displayName: mailboxes.displayName,
          domainId: mailboxes.domainId,
          canSend: mailboxes.canSend,
          createdAt: mailboxes.createdAt,
        })
        .from(aliasTargets)
        .innerJoin(mailboxes, eq(aliasTargets.targetMailboxId, mailboxes.id))
        .where(eq(aliasTargets.aliasId, alias.id));

      return { ...alias, targets };
    }),
  );

  return c.json({ data: result });
});

/**
 * POST /api/aliases
 * Create a new alias with target mailboxes.
 */
aliasesRouter.post(
  "/",
  zValidator("json", createAliasSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const { address, domainId, allowSendAs, targetMailboxIds } =
      c.req.valid("json");

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

    // Check duplicate
    const existing = await db
      .select()
      .from(aliases)
      .where(eq(aliases.address, address))
      .limit(1)
      .then((rows) => rows[0]);

    if (existing) {
      return c.json({ error: "Alias with this address already exists" }, 409);
    }

    const id = generateId();
    await db.insert(aliases).values({
      id,
      address,
      domainId,
      allowSendAs: allowSendAs ?? false,
    });

    // Insert targets
    for (const targetId of targetMailboxIds) {
      await db.insert(aliasTargets).values({
        id: generateId(),
        aliasId: id,
        targetMailboxId: targetId,
      });
    }

    // Audit log
    await db.insert(auditLogs).values({
      id: generateId(),
      userId: c.get("userId"),
      action: "alias.create",
      resourceType: "alias",
      resourceId: id,
      details: JSON.stringify({ address, targetMailboxIds }),
    });

    const created = await loadAliasWithTargets(db, id);
    return c.json(
      { data: created, message: "Alias created successfully" },
      201,
    );
  },
);

/**
 * PATCH /api/aliases/:id
 * Update alias settings or targets.
 */
aliasesRouter.patch(
  "/:id",
  zValidator("json", updateAliasSchema, (result, c) => {
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
    const { allowSendAs, targetMailboxIds } = c.req.valid("json");

    const existing = await db
      .select()
      .from(aliases)
      .where(eq(aliases.id, id))
      .limit(1)
      .then((rows) => rows[0]);

    if (!existing) {
      return c.json({ error: "Alias not found" }, 404);
    }

    // Update alias fields
    if (allowSendAs !== undefined) {
      await db
        .update(aliases)
        .set({ allowSendAs, updatedAt: new Date().toISOString() })
        .where(eq(aliases.id, id));
    }

    // Replace targets if provided
    if (targetMailboxIds) {
      await db.delete(aliasTargets).where(eq(aliasTargets.aliasId, id));
      for (const targetId of targetMailboxIds) {
        await db.insert(aliasTargets).values({
          id: generateId(),
          aliasId: id,
          targetMailboxId: targetId,
        });
      }
    }

    // Audit log
    await db.insert(auditLogs).values({
      id: generateId(),
      userId: c.get("userId"),
      action: "alias.update",
      resourceType: "alias",
      resourceId: id,
      details: JSON.stringify({ allowSendAs, targetMailboxIds }),
    });

    const updated = await loadAliasWithTargets(db, id);
    return c.json({ data: updated, message: "Alias updated successfully" });
  },
);

/**
 * DELETE /api/aliases/:id
 * Delete an alias (cascade deletes alias_targets).
 */
aliasesRouter.delete("/:id", async (c) => {
  const db = c.get("db");
  const { id } = c.req.param();

  const existing = await db
    .select()
    .from(aliases)
    .where(eq(aliases.id, id))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return c.json({ error: "Alias not found" }, 404);
  }

  await db.delete(aliases).where(eq(aliases.id, id));

  // Audit log
  await db.insert(auditLogs).values({
    id: generateId(),
    userId: c.get("userId"),
    action: "alias.delete",
    resourceType: "alias",
    resourceId: id,
    details: JSON.stringify({ address: existing.address }),
  });

  return c.json({ message: "Alias deleted successfully" });
});

export default aliasesRouter;
