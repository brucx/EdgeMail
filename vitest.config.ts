import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

/**
 * Tests run inside workerd via @cloudflare/vitest-pool-workers so Web Crypto,
 * HTMLRewriter, Request/Response, D1, R2, and KV behave exactly as they do in
 * production. Scratch bindings are created per test file.
 *
 * Uses the v4-compatible cloudflareTest plugin shape (from the pool's README
 * for vitest >=4).
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      miniflare: {
        compatibilityDate: "2025-04-01",
        compatibilityFlags: ["nodejs_compat"],
        d1Databases: ["DB"],
        r2Buckets: ["STORAGE"],
        kvNamespaces: ["RATE_LIMIT_KV"],
        bindings: {
          APP_NAME: "EdgeMail",
          ADMIN_EMAIL: "admin@example.test",
          JWT_SECRET: "test-jwt-secret",
          RESEND_API_KEY: "re_test",
          RESEND_WEBHOOK_SECRET: "",
          // 32-byte key, base64-encoded. Plaintext: "testkey-" × 4.
          ENCRYPTION_KEY: "dGVzdGtleS10ZXN0a2V5LXRlc3RrZXktdGVzdGtleS0=",
        },
      },
    }),
  ],
  resolve: {
    alias: {
      "@server": fileURLToPath(new URL("./src/server", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
});
