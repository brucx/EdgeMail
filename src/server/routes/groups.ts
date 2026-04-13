import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import {
  groups,
  groupMembers,
  domains,
  mailboxes,
  auditLogs,
} from "../db/schema";
import { generateId } from "../lib/id";
import { requireAuth } from "../middleware/auth";
import { createGroupSchema, updateGroupSchema } from "@shared/types";

const groupsRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

groupsRouter.use("/*", requireAuth);

/**
 * Helper: load group with its member mailboxes.
 */
async function loadGroupWithMembers(
  db: ReturnType<typeof import("../db").createDb>,
  groupId: string,
) {
  const group = await db
    .select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!group) return null;

  const members = await db
    .select({
      id: mailboxes.id,
      address: mailboxes.address,
      displayName: mailboxes.displayName,
      domainId: mailboxes.domainId,
      canSend: mailboxes.canSend,
      createdAt: mailboxes.createdAt,
    })
    .from(groupMembers)
    .innerJoin(mailboxes, eq(groupMembers.mailboxId, mailboxes.id))
    .where(eq(groupMembers.groupId, groupId));

  return { ...group, members };
}

/**
 * GET /api/groups
 * List all groups with their members.
 */
groupsRouter.get("/", async (c) => {
  const db = c.get("db");

  const allGroups = await db.select().from(groups).orderBy(groups.createdAt);

  // Load members for each group
  const result = await Promise.all(
    allGroups.map(async (group) => {
      const members = await db
        .select({
          id: mailboxes.id,
          address: mailboxes.address,
          displayName: mailboxes.displayName,
          domainId: mailboxes.domainId,
          canSend: mailboxes.canSend,
          createdAt: mailboxes.createdAt,
        })
        .from(groupMembers)
        .innerJoin(mailboxes, eq(groupMembers.mailboxId, mailboxes.id))
        .where(eq(groupMembers.groupId, group.id));

      return { ...group, members };
    }),
  );

  return c.json({ data: result });
});

/**
 * POST /api/groups
 * Create a new group with member mailboxes.
 */
groupsRouter.post(
  "/",
  zValidator("json", createGroupSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const { address, domainId, displayName, allowSendAs, memberMailboxIds } =
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
      .from(groups)
      .where(eq(groups.address, address))
      .limit(1)
      .then((rows) => rows[0]);

    if (existing) {
      return c.json({ error: "Group with this address already exists" }, 409);
    }

    const id = generateId();
    await db.insert(groups).values({
      id,
      address,
      domainId,
      displayName,
      allowSendAs: allowSendAs ?? false,
    });

    // Insert members
    for (const memberId of memberMailboxIds) {
      await db.insert(groupMembers).values({
        id: generateId(),
        groupId: id,
        mailboxId: memberId,
      });
    }

    // Audit log
    await db.insert(auditLogs).values({
      id: generateId(),
      userId: c.get("userId"),
      action: "group.create",
      resourceType: "group",
      resourceId: id,
      details: JSON.stringify({ address, memberMailboxIds }),
    });

    const created = await loadGroupWithMembers(db, id);
    return c.json(
      { data: created, message: "Group created successfully" },
      201,
    );
  },
);

/**
 * PATCH /api/groups/:id
 * Update group settings or members.
 */
groupsRouter.patch(
  "/:id",
  zValidator("json", updateGroupSchema, (result, c) => {
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
    const { displayName, allowSendAs, memberMailboxIds } = c.req.valid("json");

    const existing = await db
      .select()
      .from(groups)
      .where(eq(groups.id, id))
      .limit(1)
      .then((rows) => rows[0]);

    if (!existing) {
      return c.json({ error: "Group not found" }, 404);
    }

    // Update group fields
    const updateFields: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (displayName !== undefined) updateFields.displayName = displayName;
    if (allowSendAs !== undefined) updateFields.allowSendAs = allowSendAs;

    await db.update(groups).set(updateFields).where(eq(groups.id, id));

    // Replace members if provided
    if (memberMailboxIds) {
      await db.delete(groupMembers).where(eq(groupMembers.groupId, id));
      for (const memberId of memberMailboxIds) {
        await db.insert(groupMembers).values({
          id: generateId(),
          groupId: id,
          mailboxId: memberId,
        });
      }
    }

    // Audit log
    await db.insert(auditLogs).values({
      id: generateId(),
      userId: c.get("userId"),
      action: "group.update",
      resourceType: "group",
      resourceId: id,
      details: JSON.stringify({ displayName, allowSendAs, memberMailboxIds }),
    });

    const updated = await loadGroupWithMembers(db, id);
    return c.json({ data: updated, message: "Group updated successfully" });
  },
);

/**
 * DELETE /api/groups/:id
 * Delete a group (cascade deletes group_members).
 */
groupsRouter.delete("/:id", async (c) => {
  const db = c.get("db");
  const { id } = c.req.param();

  const existing = await db
    .select()
    .from(groups)
    .where(eq(groups.id, id))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return c.json({ error: "Group not found" }, 404);
  }

  await db.delete(groups).where(eq(groups.id, id));

  // Audit log
  await db.insert(auditLogs).values({
    id: generateId(),
    userId: c.get("userId"),
    action: "group.delete",
    resourceType: "group",
    resourceId: id,
    details: JSON.stringify({ address: existing.address }),
  });

  return c.json({ message: "Group deleted successfully" });
});

export default groupsRouter;
