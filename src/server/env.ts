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

  // 256-bit AES-GCM key (base64) used to encrypt per-domain secrets stored in D1.
  // Generate with: openssl rand -base64 32
  ENCRYPTION_KEY: string;

  // Cloudflare API integration (optional — feature disabled when absent)
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CF_WORKER_NAME?: string; // defaults to "edgemail"

  // Non-secret vars (set in wrangler.jsonc)
  APP_NAME: string;
  D1_DATABASE_ID?: string;
  R2_BUCKET_NAME?: string;
}

/**
 * Hono request-scoped variables, set by middleware.
 */
export interface AppVariables {
  db: DrizzleD1Database<typeof schema>;
  userId: string | null;
  sessionId: string | null;
  apiTokenId: string | null;
  apiTokenPermissions: string[] | null;
  apiTokenDomainId: string | null;
}
