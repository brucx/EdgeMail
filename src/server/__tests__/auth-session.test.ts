import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { createDb } from "../db";
import { ensureTablesExist } from "../db/migrate";
import { users, sessions } from "../db/schema";
import { authSession, requireAuth } from "../middleware/auth";
import { createLogger } from "../lib/logger";
import { generateId } from "../lib/id";
import { hashPassword, CURRENT_PASSWORD_ALGO, generateSessionToken } from "../lib/crypto";

/**
 * Smoke tests for the session middleware: accepts valid tokens, rejects
 * expired ones, and expires-lazy-deletes expired rows from D1 post-response.
 */
describe("authSession middleware", () => {
  beforeEach(async () => {
    await ensureTablesExist(env.DB);
    const db = createDb(env.DB);
    await db.delete(sessions);
    await db.delete(users);
  });

  function buildApp() {
    const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("logger", createLogger({}));
      c.set("requestId", "t");
      c.set("db", createDb(c.env.DB));
      await next();
    });
    app.use("*", authSession);
    app.get("/protected", requireAuth, (c) => c.json({ userId: c.get("userId") }));
    return app;
  }

  async function seedUser(): Promise<string> {
    const db = createDb(env.DB);
    const id = generateId();
    await db.insert(users).values({
      id,
      email: `${id}@t.test`,
      passwordHash: await hashPassword("pw12345678"),
      passwordAlgo: CURRENT_PASSWORD_ALGO,
      displayName: "T",
    });
    return id;
  }

  it("accepts valid session via Authorization header", async () => {
    const userId = await seedUser();
    const db = createDb(env.DB);
    const token = generateSessionToken();
    await db.insert(sessions).values({
      id: generateId(),
      userId,
      token,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const app = buildApp();
    const res = await app.request(
      "/protected",
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string };
    expect(body.userId).toBe(userId);
  });

  it("rejects when no credentials are presented", async () => {
    const app = buildApp();
    const res = await app.request("/protected", {}, env);
    expect(res.status).toBe(401);
  });

  it("rejects expired sessions and cleans them up lazily", async () => {
    const userId = await seedUser();
    const db = createDb(env.DB);
    const token = generateSessionToken();
    const sid = generateId();
    await db.insert(sessions).values({
      id: sid,
      userId,
      token,
      expiresAt: new Date(Date.now() - 60_000).toISOString(), // already expired
    });

    const app = buildApp();
    const res = await app.request(
      "/protected",
      { headers: { Authorization: `Bearer ${token}` } },
      env,
    );
    expect(res.status).toBe(401);

    // The middleware fires the cleanup via `waitUntil`; in tests we can
    // simply wait for the row to be gone or assert within a short window.
    // vitest-pool-workers flushes waitUntil before the test ends, so it
    // should be gone by the time we query.
    const remaining = await db.select().from(sessions).where(eq(sessions.id, sid));
    expect(remaining).toHaveLength(0);
  });
});
