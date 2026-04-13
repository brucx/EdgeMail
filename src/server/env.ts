import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./db/schema";

/**
 * Cloudflare Worker bindings — these are configured in wrangler.jsonc.
 */
export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Bucket for raw emails and attachments
  STORAGE: R2Bucket;

  // Environment variables (secrets — set via wrangler secret put or .dev.vars)
  RESEND_API_KEY: string;
  JWT_SECRET: string;
  RESEND_WEBHOOK_SECRET: string;
  ADMIN_EMAIL: string; // Used during setup to validate admin initialization

  // Non-secret vars (set in wrangler.jsonc)
  APP_NAME: string;
}

/**
 * Hono request-scoped variables, set by middleware.
 */
export interface AppVariables {
  db: DrizzleD1Database<typeof schema>;
  userId: string | null;
  sessionId: string | null;
}
