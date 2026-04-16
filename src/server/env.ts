import type { Database } from "./db";
import type { Logger } from "./lib/logger";

/**
 * Cloudflare Worker bindings — these are configured in wrangler.jsonc.
 */
export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Bucket for raw emails and attachments
  STORAGE: R2Bucket;

  // KV namespace for rate limiting. Optional — when absent, rate limiting is
  // disabled with a warning log (see middleware/rate-limit.ts).
  RATE_LIMIT_KV?: KVNamespace;

  // Environment variables (secrets — set via wrangler secret put or .dev.vars)
  RESEND_API_KEY: string;
  JWT_SECRET: string;
  RESEND_WEBHOOK_SECRET: string;
  ADMIN_EMAIL: string; // Used during setup to validate admin initialization

  // 256-bit AES-GCM key (base64) used to encrypt per-domain secrets stored in D1.
  // Generate with: openssl rand -base64 32
  ENCRYPTION_KEY: string;
  // Previous KEK used only during rotation. If a ciphertext was written with
  // an older version, decryptSecret will fall back to this key.
  ENCRYPTION_KEY_V1?: string;

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
  db: Database;
  userId: string | null;
  sessionId: string | null;
  apiTokenId: string | null;
  apiTokenPermissions: string[] | null;
  apiTokenDomainId: string | null;
  // Request-scoped logger. Always populated by the logging middleware.
  logger: Logger;
  requestId: string;
}
