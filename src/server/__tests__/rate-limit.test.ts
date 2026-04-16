import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import type { Env, AppVariables } from "../env";
import { rateLimit } from "../middleware/rate-limit";
import { createLogger } from "../lib/logger";

describe("rate-limit middleware", () => {
  let app: Hono<{ Bindings: Env; Variables: AppVariables }>;

  beforeAll(() => {
    app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
    app.use("*", async (c, next) => {
      c.set("logger", createLogger({ component: "test" }));
      c.set("requestId", "t");
      c.set("userId", null);
      c.set("sessionId", null);
      c.set("apiTokenId", null);
      c.set("apiTokenPermissions", null);
      c.set("apiTokenDomainId", null);
      // Provide `db` as unknown — not used by rate-limit.
      c.set("db", {} as AppVariables["db"]);
      await next();
    });
    app.use(
      "/limited/*",
      rateLimit({
        bucket: "test",
        max: 2,
        windowSec: 60,
        keyFn: () => "fixed-key",
      }),
    );
    app.get("/limited/ping", (c) => c.text("ok"));
  });

  it("allows up to max, rejects with 429 after", async () => {
    const res1 = await app.request("/limited/ping", {}, env);
    expect(res1.status).toBe(200);
    const res2 = await app.request("/limited/ping", {}, env);
    expect(res2.status).toBe(200);
    const res3 = await app.request("/limited/ping", {}, env);
    expect(res3.status).toBe(429);
    expect(res3.headers.get("Retry-After")).toBeTruthy();
  });
});
