import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq, ne } from "drizzle-orm";
import { setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import type { Env, AppVariables } from "../env";
import { users, sessions, auditLogs } from "../db/schema";
import {
  verifyPassword,
  hashPassword,
  generateSessionToken,
  CURRENT_PASSWORD_ALGO,
  type PasswordAlgo,
} from "../lib/crypto";
import { generateId } from "../lib/id";
import {
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} from "@shared/types";
import { requireAuth } from "../middleware/auth";

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/**
 * POST /api/auth/login
 * Authenticate with email + password, create session, set cookie.
 */
auth.post(
  "/login",
  zValidator("json", loginSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const log = c.get("logger");
    const { email, password } = c.req.valid("json");

    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .then((rows) => rows[0]);

    if (!user) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    // Pick verification algorithm from the stored field, falling back to
    // legacy HMAC for rows written before P0-6.
    const algo = (user.passwordAlgo as PasswordAlgo | null) ?? "hmac-sha256-10k";

    let valid: boolean;
    try {
      valid = await verifyPassword(password, user.passwordHash, algo);
    } catch (err) {
      log.error("password verification threw", { err });
      return c.json({ error: "Internal error during authentication" }, 500);
    }
    if (!valid) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    // Transparent password-hash upgrade: if the user is on the legacy algo,
    // re-hash with the current one. Synchronous — cost is ~30ms.
    if (algo !== CURRENT_PASSWORD_ALGO) {
      const newHash = await hashPassword(password);
      await db
        .update(users)
        .set({
          passwordHash: newHash,
          passwordAlgo: CURRENT_PASSWORD_ALGO,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, user.id));
      log.info("password rehashed to current algo", { userId: user.id });
    }

    return await issueSession(c, user.id, user.email, user.displayName, user.role);
  },
);

/**
 * Internal helper: mint a session, set the cookie, and return the user JSON.
 */
export async function issueSession(
  c: AppContext,
  userId: string,
  email: string,
  displayName: string,
  role: string,
) {
  const db = c.get("db");
  const token = generateSessionToken();
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString();

  await db.insert(sessions).values({
    id: sessionId,
    userId,
    token,
    expiresAt,
  });

  setCookie(c, "session", token, {
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  return c.json({
    data: { id: userId, email, displayName, role },
    message: "Login successful",
  });
}

/**
 * POST /api/auth/logout
 * Invalidate the current session and clear the cookie.
 */
auth.post("/logout", async (c) => {
  const sessionId = c.get("sessionId");

  if (sessionId) {
    const db = c.get("db");
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  deleteCookie(c, "session", {
    path: "/",
  });

  return c.json({ message: "Logged out successfully" });
});

/**
 * GET /api/auth/me
 */
auth.get("/me", requireAuth, async (c) => {
  const db = c.get("db");
  const userId = c.get("userId")!;

  const user = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ data: user });
});

/**
 * PATCH /api/auth/me
 * Update the current user's profile (display name only for now).
 */
auth.patch(
  "/me",
  requireAuth,
  zValidator("json", updateProfileSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const userId = c.get("userId")!;
    const { displayName } = c.req.valid("json");

    await db
      .update(users)
      .set({ displayName, updatedAt: new Date().toISOString() })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      id: generateId(),
      userId,
      action: "user.update",
      resourceType: "user",
      resourceId: userId,
      details: JSON.stringify({ displayName }),
    });

    const user = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((rows) => rows[0]);

    return c.json({ data: user, message: "Profile updated" });
  },
);

/**
 * POST /api/auth/password
 * Change the current user's password. Verifies the current password,
 * rehashes the new one, and revokes all OTHER sessions.
 */
auth.post(
  "/password",
  requireAuth,
  zValidator("json", changePasswordSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const log = c.get("logger");
    const userId = c.get("userId")!;
    const sessionId = c.get("sessionId");
    const { currentPassword, newPassword } = c.req.valid("json");

    if (currentPassword === newPassword) {
      return c.json(
        { error: "New password must differ from current password" },
        400,
      );
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((rows) => rows[0]);

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    const algo = (user.passwordAlgo as PasswordAlgo | null) ?? "hmac-sha256-10k";
    let valid: boolean;
    try {
      valid = await verifyPassword(currentPassword, user.passwordHash, algo);
    } catch (err) {
      log.error("password verification threw", { err });
      return c.json({ error: "Internal error during authentication" }, 500);
    }
    if (!valid) {
      return c.json({ error: "Current password is incorrect" }, 401);
    }

    const newHash = await hashPassword(newPassword);

    await db
      .update(users)
      .set({
        passwordHash: newHash,
        passwordAlgo: CURRENT_PASSWORD_ALGO,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));

    // Revoke this user's other sessions — force re-login elsewhere.
    if (sessionId) {
      await db
        .delete(sessions)
        .where(
          and(eq(sessions.userId, userId), ne(sessions.id, sessionId)),
        );
    } else {
      await db.delete(sessions).where(eq(sessions.userId, userId));
    }

    await db.insert(auditLogs).values({
      id: generateId(),
      userId,
      action: "user.password_change",
      resourceType: "user",
      resourceId: userId,
    });

    return c.json({ message: "Password updated. Other sessions were signed out." });
  },
);

export default auth;
