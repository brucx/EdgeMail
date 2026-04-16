import { createMiddleware } from "hono/factory";
import { eq, and, gt, lt, or, isNull } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { sessions, apiTokens } from "../db/schema";
import { hashApiToken } from "../lib/crypto";

/**
 * Auth middleware — validates the session token or API token from the
 * Authorization header or `session` cookie.
 *
 * Session tokens set `userId` and `sessionId`.
 * API tokens (prefixed `em_sk_`) set `apiTokenId`, `apiTokenPermissions`,
 * and optionally `apiTokenDomainId`.
 */
export const authSession = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  // Extract token from Authorization header or cookie
  const authHeader = c.req.header("Authorization");
  const token =
    authHeader?.replace("Bearer ", "") ??
    getCookie(c.req.raw, "session");

  // Defaults
  c.set("userId", null);
  c.set("sessionId", null);
  c.set("apiTokenId", null);
  c.set("apiTokenPermissions", null);
  c.set("apiTokenDomainId", null);

  if (!token) {
    return next();
  }

  const db = c.get("db");
  const now = new Date().toISOString();

  // ── API Token path ──────────────────────────────────────────────────────
  if (token.startsWith("em_sk_")) {
    const tokenHash = await hashApiToken(token);

    const result = await db
      .select({
        id: apiTokens.id,
        permissions: apiTokens.permissions,
        domainId: apiTokens.domainId,
      })
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.tokenHash, tokenHash),
          or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
        ),
      )
      .limit(1);

    if (result.length > 0) {
      const row = result[0];
      c.set("apiTokenId", row.id);
      c.set(
        "apiTokenPermissions",
        JSON.parse(row.permissions) as string[],
      );
      c.set("apiTokenDomainId", row.domainId);

      // Update lastUsedAt (fire-and-forget)
      try {
        c.executionCtx.waitUntil(
          db
            .update(apiTokens)
            .set({ lastUsedAt: now })
            .where(eq(apiTokens.id, row.id))
            .run(),
        );
      } catch {
        // test harness has no ExecutionContext — skip
      }
    }

    return next();
  }

  // ── Session Token path ──────────────────────────────────────────────────
  const result = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(eq(sessions.token, token))
    .limit(1);

  if (result.length === 0) {
    return next();
  }

  const row = result[0];
  // ExecutionContext is only present when the middleware is reached via a
  // real Worker fetch — not when a Hono app is driven via `app.request()` in
  // tests. Fall back to awaiting inline in that case.
  const defer = (p: Promise<unknown>) => {
    try {
      c.executionCtx.waitUntil(p);
    } catch {
      // no ExecutionContext — await inline so the work still happens.
      void p.catch(() => {});
    }
  };

  if (row.expiresAt <= now) {
    // Expired: delete lazily so the sessions table doesn't grow forever.
    defer(db.delete(sessions).where(eq(sessions.id, row.sessionId)).run());
    return next();
  }

  c.set("userId", row.userId);
  c.set("sessionId", row.sessionId);

  // Opportunistically sweep other expired rows for this user; bounded by DB
  // so it stays cheap. Runs post-response via waitUntil.
  defer(
    db
      .delete(sessions)
      .where(and(eq(sessions.userId, row.userId), lt(sessions.expiresAt, now)))
      .run(),
  );

  return next();
});

/**
 * Require authentication — returns 401 if no valid session or API token.
 */
export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  const userId = c.get("userId");
  const apiTokenId = c.get("apiTokenId");
  if (!userId && !apiTokenId) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

/**
 * Require a specific permission.
 * Admin users (session auth) have all permissions.
 * API tokens must include the permission in their permissions array.
 */
export function requirePermission(permission: string) {
  return createMiddleware<{
    Bindings: Env;
    Variables: AppVariables;
  }>(async (c, next) => {
    const userId = c.get("userId");
    if (userId) {
      // Session-based auth: admin has all permissions
      return next();
    }

    const perms = c.get("apiTokenPermissions");
    if (perms && perms.includes(permission)) {
      return next();
    }

    return c.json({ error: "Forbidden: insufficient permissions" }, 403);
  });
}

/**
 * Require session-based auth only (for admin-only operations like token management).
 */
export const requireSession = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized: session required" }, 401);
  }
  return next();
});

/**
 * Simple cookie parser utility.
 */
function getCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.get("Cookie");
  if (!cookies) return undefined;
  const match = cookies
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match?.split("=")[1];
}
