import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, and, gt } from "drizzle-orm";
import { setCookie, deleteCookie } from "hono/cookie";
import type { Env, AppVariables } from "../env";
import { users, sessions } from "../db/schema";
import { verifyPassword, generateSessionToken } from "../lib/crypto";
import { generateId } from "../lib/id";
import { loginSchema } from "@shared/types";
import { requireAuth } from "../middleware/auth";

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
    const { email, password } = c.req.valid("json");

    // Find user by email
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .then((rows) => rows[0]);

    if (!user) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    // Verify password
    let valid: boolean;
    try {
      valid = await verifyPassword(password, user.passwordHash);
    } catch (err) {
      console.error("[EdgeMail] Password verification error:", err);
      return c.json({ error: "Internal error during authentication" }, 500);
    }
    if (!valid) {
      return c.json({ error: "Invalid email or password" }, 401);
    }

    // Create session
    const token = generateSessionToken();
    const sessionId = generateId();
    const expiresAt = new Date(
      Date.now() + SESSION_MAX_AGE * 1000,
    ).toISOString();

    await db.insert(sessions).values({
      id: sessionId,
      userId: user.id,
      token,
      expiresAt,
    });

    // Set session cookie
    setCookie(c, "session", token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return c.json({
      data: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      message: "Login successful",
    });
  },
);

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
 * Get the current authenticated user's info.
 * Returns 401 if not authenticated.
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

export default auth;
