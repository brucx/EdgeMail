import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * Create a Drizzle ORM instance bound to a D1 database.
 * Call this once per request with `env.DB`.
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDb>;
