// Tells TypeScript about the `cloudflare:test` module provided by the
// @cloudflare/vitest-pool-workers runtime. The package ships the type
// file but not as a top-level module declaration, so we re-export it here.

/// <reference types="@cloudflare/vitest-pool-workers" />

declare module "cloudflare:test" {
  import type { Env } from "../env";
  export const env: Env;
}
