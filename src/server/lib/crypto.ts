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

// ─── API Token Helpers ──────────────────────────────────────────────────────

/**
 * Generate a new API token: "em_sk_" + 48 random hex chars.
 */
export function generateApiToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `em_sk_${bufToHex(bytes)}`;
}

/**
 * SHA-256 hash of a full API token string, returned as hex.
 */
export async function hashApiToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data.buffer);
  return bufToHex(new Uint8Array(hash));
}

// ─── Symmetric Encryption (AES-GCM) ─────────────────────────────────────────

// Domain: encrypting per-domain secrets (e.g. Resend API keys) stored in D1.
// The key-encryption-key (KEK) is a base64 32-byte value held in env.ENCRYPTION_KEY.
// Ciphertext format: base64( iv (12B) || ciphertext || auth tag ).

const AES_IV_LENGTH = 12;

async function importAesKey(keyB64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyB64);
  if (raw.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must decode to 32 bytes (256-bit). Generate with: openssl rand -base64 32",
    );
  }
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptSecret(
  plaintext: string,
  keyB64: string,
): Promise<string> {
  const key = await importAesKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_LENGTH));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const packed = new Uint8Array(iv.length + ct.length);
  packed.set(iv, 0);
  packed.set(ct, iv.length);
  return bytesToBase64(packed);
}

export async function decryptSecret(
  ciphertextB64: string,
  keyB64: string,
): Promise<string> {
  const key = await importAesKey(keyB64);
  const packed = base64ToBytes(ciphertextB64);
  if (packed.length <= AES_IV_LENGTH) {
    throw new Error("Ciphertext too short");
  }
  const iv = packed.slice(0, AES_IV_LENGTH);
  const ct = packed.slice(AES_IV_LENGTH);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

/**
 * Short hint for display: "re_abc…wxyz". Never returns the full secret.
 * Returns null for empty input.
 */
export function maskSecret(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  if (plaintext.length <= 8) return "****";
  return `${plaintext.slice(0, 4)}…${plaintext.slice(-4)}`;
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

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
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
