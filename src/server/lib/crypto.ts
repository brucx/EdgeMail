/**
 * Cryptographic utilities: password hashing, session tokens, symmetric secrets.
 *
 * Password hashing (two supported algorithms, selected per-user via
 * `users.password_algo`):
 *   - "pbkdf2-sha256-310k" — current default, OWASP 2024 recommendation.
 *     ~30–60ms per verify on Cloudflare Workers, fine under Worker CPU limits.
 *   - "hmac-sha256-10k" — legacy. Retained only to verify existing accounts
 *     created before P0-6. On successful verify we auto-upgrade the stored
 *     hash to the new algorithm during login (see routes/auth.ts).
 *
 * Symmetric encryption of per-domain secrets (AES-GCM) supports multi-version
 * keys via a ciphertext prefix ("v1:", "v2:", …). When ENCRYPTION_KEY rotates,
 * you set ENCRYPTION_KEY_V1 to the old key; decryptSecret transparently picks
 * the right KEK based on the ciphertext version. Encryption always uses the
 * current (unprefixed env) key and emits the current version prefix.
 *
 * Legacy ciphertexts written before multi-version support (no prefix) are
 * treated as version "v0" and decrypt against the current ENCRYPTION_KEY.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 310_000; // OWASP 2024 for PBKDF2-SHA256
const HMAC_ITERATIONS = 10_000; // legacy only
const KEY_BITS = 256;

export type PasswordAlgo = "pbkdf2-sha256-310k" | "hmac-sha256-10k";
export const CURRENT_PASSWORD_ALGO: PasswordAlgo = "pbkdf2-sha256-310k";

// ─── Password Hashing ───────────────────────────────────────────────────────

/**
 * Hash a password with the current default algorithm (PBKDF2-SHA256, 310k).
 * Returns `salt:hash` in hex.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `${bufToHex(salt)}:${bufToHex(new Uint8Array(hash))}`;
}

/**
 * Verify a password against a stored hash. Picks the algorithm based on
 * `algo`; defaults to the legacy HMAC algorithm when `algo` is undefined to
 * match data written before P0-6.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
  algo: PasswordAlgo = "hmac-sha256-10k",
): Promise<boolean> {
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;
  const [saltHex, expectedHex] = parts;
  if (!saltHex || !expectedHex) return false;

  const salt = hexToBuf(saltHex);
  let actual: ArrayBuffer;
  if (algo === "pbkdf2-sha256-310k") {
    actual = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  } else {
    actual = await hmacDerive(password, salt, HMAC_ITERATIONS);
  }
  return timingSafeEqual(bufToHex(new Uint8Array(actual)), expectedHex);
}

/**
 * PBKDF2-SHA256 key derivation. Fine on Cloudflare Workers at 310k iterations.
 */
async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  return crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations,
    },
    keyMaterial,
    KEY_BITS,
  );
}

/**
 * Legacy HMAC-SHA256 iterated key derivation. Kept purely so existing
 * accounts can still log in; new hashes always use PBKDF2.
 */
async function hmacDerive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // First round seeds from the salt; subsequent rounds chain the previous
  // digest. This mirrors the pre-P0-6 behavior for exact hash compatibility.
  let buf = await crypto.subtle.sign(
    "HMAC",
    keyMaterial,
    salt as BufferSource,
  );
  for (let i = 1; i < iterations; i++) {
    buf = await crypto.subtle.sign("HMAC", keyMaterial, buf);
  }
  return buf;
}

// ─── Session & API Tokens ───────────────────────────────────────────────────

export function generateSessionToken(): string {
  return bufToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function generateApiToken(): string {
  return `em_sk_${bufToHex(crypto.getRandomValues(new Uint8Array(24)))}`;
}

export async function hashApiToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data.buffer);
  return bufToHex(new Uint8Array(digest));
}

// ─── Symmetric Encryption (AES-GCM, multi-version KEK) ──────────────────────

const AES_IV_LENGTH = 12;
const CURRENT_KEY_VERSION = "v1"; // bumps when ENCRYPTION_KEY rotates

/**
 * Minimal env shape used for key-rotation lookups. Passing the whole Env is
 * convenient at call sites; only the two key fields are ever read.
 */
export interface EncryptionEnv {
  ENCRYPTION_KEY: string;
  ENCRYPTION_KEY_V1?: string; // previous KEK during rotation
}

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

/**
 * Encrypt a secret with the current KEK; ciphertext is prefixed with the
 * version tag so future reads can find the right key.
 */
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
  return `${CURRENT_KEY_VERSION}:${bytesToBase64(packed)}`;
}

/**
 * Decrypt a secret. Picks KEK by version prefix:
 *   "v1:…" → env.ENCRYPTION_KEY (current)
 *   no prefix → legacy (pre-rotation) → env.ENCRYPTION_KEY (best-effort)
 *   any other "vX:" → env.ENCRYPTION_KEY_V1 fallback
 */
export async function decryptSecret(
  stored: string,
  env: EncryptionEnv,
): Promise<string> {
  const { version, payload } = parseVersioned(stored);
  const keyB64 = pickKey(version, env);
  if (!keyB64) {
    throw new Error(
      `No KEK available for ciphertext version "${version}". Set ENCRYPTION_KEY_V1 to the previous key and retry.`,
    );
  }
  const key = await importAesKey(keyB64);
  const packed = base64ToBytes(payload);
  if (packed.length <= AES_IV_LENGTH) throw new Error("Ciphertext too short");
  const iv = packed.slice(0, AES_IV_LENGTH);
  const ct = packed.slice(AES_IV_LENGTH);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

function parseVersioned(s: string): { version: string; payload: string } {
  const m = /^(v\d+):(.+)$/.exec(s);
  if (m) return { version: m[1], payload: m[2] };
  return { version: "v0", payload: s }; // legacy, unversioned
}

function pickKey(version: string, env: EncryptionEnv): string | undefined {
  if (version === CURRENT_KEY_VERSION || version === "v0") {
    return env.ENCRYPTION_KEY;
  }
  // Any prior version — try the rotation fallback first.
  return env.ENCRYPTION_KEY_V1 || env.ENCRYPTION_KEY;
}

/**
 * Short display hint for a secret: "re_a…wxyz". Never returns the full value.
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
