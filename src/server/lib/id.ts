/**
 * Generate a unique ID using crypto.randomUUID().
 * No external dependency needed — available in Cloudflare Workers.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
