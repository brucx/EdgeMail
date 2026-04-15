import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { apiTokens, auditLogs } from "../db/schema";
import { generateId } from "../lib/id";
import { generateApiToken, hashApiToken } from "../lib/crypto";
import { requireSession } from "../middleware/auth";
import { createApiTokenSchema } from "@shared/types";

const tokensRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// All token management requires session auth (not API token auth)
tokensRouter.use("/*", requireSession);

/**
 * GET /api/tokens
 * List all API tokens (metadata only, never hashes).
 */
tokensRouter.get("/", async (c) => {
  const db = c.get("db");

  const tokens = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      permissions: apiTokens.permissions,
      domainId: apiTokens.domainId,
      lastUsedAt: apiTokens.lastUsedAt,
      expiresAt: apiTokens.expiresAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .orderBy(apiTokens.createdAt);

  const result = tokens.map((t) => ({
    ...t,
    permissions: JSON.parse(t.permissions) as string[],
  }));

  return c.json({ data: result });
});

/**
 * POST /api/tokens
 * Create a new API token. Returns the full token ONCE.
 */
tokensRouter.post(
  "/",
  zValidator("json", createApiTokenSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const { name, permissions, domainId, expiresAt } = c.req.valid("json");

    const rawToken = generateApiToken();
    const tokenHash = await hashApiToken(rawToken);
    const prefix = rawToken.substring(0, 12); // "em_sk_" + 6 hex chars

    const id = generateId();
    await db.insert(apiTokens).values({
      id,
      name,
      tokenHash,
      prefix,
      permissions: JSON.stringify(permissions),
      domainId: domainId ?? null,
      expiresAt: expiresAt ?? null,
    });

    // Audit log
    await db.insert(auditLogs).values({
      id: generateId(),
      userId: c.get("userId"),
      action: "api_token.create",
      resourceType: "api_token",
      resourceId: id,
      details: JSON.stringify({ name, permissions, domainId }),
    });

    return c.json(
      {
        token: rawToken,
        data: {
          id,
          name,
          prefix,
          permissions,
          domainId: domainId ?? null,
          lastUsedAt: null,
          expiresAt: expiresAt ?? null,
          createdAt: new Date().toISOString(),
        },
        message: "Token created successfully. Save it now — it won't be shown again.",
      },
      201,
    );
  },
);

/**
 * DELETE /api/tokens/:id
 * Revoke an API token.
 */
tokensRouter.delete("/:id", async (c) => {
  const db = c.get("db");
  const { id } = c.req.param();

  const existing = await db
    .select({ id: apiTokens.id, name: apiTokens.name })
    .from(apiTokens)
    .where(eq(apiTokens.id, id))
    .limit(1)
    .then((rows) => rows[0]);

  if (!existing) {
    return c.json({ error: "Token not found" }, 404);
  }

  await db.delete(apiTokens).where(eq(apiTokens.id, id));

  // Audit log
  await db.insert(auditLogs).values({
    id: generateId(),
    userId: c.get("userId"),
    action: "api_token.delete",
    resourceType: "api_token",
    resourceId: id,
    details: JSON.stringify({ name: existing.name }),
  });

  return c.json({ message: "Token revoked successfully" });
});

export default tokensRouter;
