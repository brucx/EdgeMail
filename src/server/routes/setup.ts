import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, count } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { users } from "../db/schema";
import { hashPassword } from "../lib/crypto";
import { generateId } from "../lib/id";
import { setupSchema } from "@shared/types";

const setup = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/**
 * GET /api/setup/status
 * Check if the system has been initialized (any admin user exists).
 */
setup.get("/status", async (c) => {
  const db = c.get("db");
  const result = await db.select({ value: count() }).from(users);
  const userCount = result[0]?.value ?? 0;
  return c.json({ initialized: userCount > 0 });
});

/**
 * POST /api/setup/init
 * Initialize the first admin account.
 * Only works when no users exist in the database.
 */
setup.post(
  "/init",
  zValidator("json", setupSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");

    // Check no existing users
    const result = await db.select({ value: count() }).from(users);
    const userCount = result[0]?.value ?? 0;
    if (userCount > 0) {
      return c.json({ error: "System already initialized" }, 409);
    }

    const { email, password, displayName } = c.req.valid("json");

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create admin user
    const id = generateId();
    await db.insert(users).values({
      id,
      email,
      passwordHash,
      displayName,
      role: "admin",
    });

    return c.json({
      data: { id, email, displayName, role: "admin" },
      message: "Admin account created successfully",
    });
  },
);

export default setup;
