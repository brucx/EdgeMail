import { createMiddleware } from "hono/factory";
import { eq, and, gt } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { sessions, users } from "../db/schema";

/**
 * Auth middleware — validates the session token from the Authorization header
 * or `session` cookie. Sets `userId` and `sessionId` in the Hono context.
 *
 * For unauthenticated requests, userId/sessionId are set to null.
 * Use `requireAuth` middleware to enforce authentication.
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

  if (!token) {
    c.set("userId", null);
    c.set("sessionId", null);
    return next();
  }

  // Validate session against D1
  const db = c.get("db");
  const now = new Date().toISOString();

  const result = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
    })
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .limit(1);

  if (result.length === 0) {
    c.set("userId", null);
    c.set("sessionId", null);
    return next();
  }

  c.set("userId", result[0].userId);
  c.set("sessionId", result[0].sessionId);
  return next();
});

/**
 * Require authentication — returns 401 if no valid session.
 */
export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
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
