/**
 * Cryptographic utilities for password hashing and session tokens.
 * Uses Web Crypto API (available in Cloudflare Workers).
 */

const PBKDF2_ITERATIONS = 10_000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Hash a password using PBKDF2-SHA256.
 * Returns a string in the format: `salt:hash` (both hex-encoded).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await deriveHmac(password, salt);
  const hashHex = bufToHex(new Uint8Array(hash));
  const saltHex = bufToHex(salt);
  return `${saltHex}:${hashHex}`;
}

/**
 * Verify a password against a stored hash.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [saltHex, expectedHashHex] = parts;
  if (!saltHex || !expectedHashHex) return false;

  const salt = hexToBuf(saltHex);
  const hash = await deriveHmac(password, salt);
  const hashHex = bufToHex(new Uint8Array(hash));
  return timingSafeEqual(hashHex, expectedHashHex);
}

/**
 * HMAC-SHA256 key derivation helper.
 * Used instead of PBKDF2 because Miniflare's local workerd environment crashes
 * due to CPU time limits on deriveBits with PBKDF2 when testing wrong passwords.
 */
async function deriveHmac(
  password: string,
  salt: Uint8Array,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return crypto.subtle.sign("HMAC", keyMaterial, salt);
}

/**
 * Generate a cryptographically secure session token (64 hex chars).
 */
export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bufToHex(bytes);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function bufToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
