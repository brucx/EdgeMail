import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { Env, AppVariables } from "../env";

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

/**
 * Fixed-window KV rate limiter.
 *
 * Why fixed-window and not sliding: KV has eventual consistency and ~1s write
 * propagation, so sliding-window bookkeeping isn't worth the complexity. The
 * boundary-burst problem for this use case (30 sends/min, 500/day) is
 * acceptable — a malicious caller gets at most 2× the quota at the boundary.
 *
 * Graceful degradation: if `env.RATE_LIMIT_KV` is not bound, the middleware
 * logs a warning once per request and allows the call through. This keeps
 * the Worker bootable during local dev / before operators add the binding.
 */

export interface RateLimitOptions {
  /** Request limit per window. */
  max: number;
  /** Window length in seconds. */
  windowSec: number;
  /** Returns a stable key for this request (e.g. mailbox id, user id). */
  keyFn: (c: AppContext) => Promise<string | null> | string | null;
  /** Prefix in KV; lets multiple limiters share the namespace. */
  bucket: string;
}

export function rateLimit(opts: RateLimitOptions) {
  return createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
    const logger = c.get("logger");
    const kv = c.env.RATE_LIMIT_KV;

    if (!kv) {
      logger?.warn("rate-limit: RATE_LIMIT_KV binding missing, allowing request", {
        bucket: opts.bucket,
      });
      return next();
    }

    const keyPart = await opts.keyFn(c);
    if (!keyPart) return next(); // no key = nothing to limit (e.g. unauth)

    const now = Math.floor(Date.now() / 1000);
    const windowIndex = Math.floor(now / opts.windowSec);
    const key = `rl:${opts.bucket}:${keyPart}:${windowIndex}`;

    const existingRaw = await kv.get(key);
    const current = existingRaw ? parseInt(existingRaw, 10) : 0;

    if (current >= opts.max) {
      const retryAfter = opts.windowSec - (now % opts.windowSec);
      logger?.warn("rate-limit exceeded", {
        bucket: opts.bucket,
        key: keyPart,
        current,
        max: opts.max,
      });
      return c.json(
        {
          error: "Too many requests. Please slow down.",
          retryAfter,
        },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    // Increment. TTL = window length + small buffer so the entry vanishes
    // shortly after the window rolls over (KV min TTL is 60s).
    await kv.put(key, String(current + 1), {
      expirationTtl: Math.max(opts.windowSec + 10, 60),
    });

    return next();
  });
}
