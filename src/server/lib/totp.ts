/**
 * RFC 6238 TOTP implementation using the Web Crypto API.
 *
 * Intentionally dependency-free: every step is ~10 lines of standard
 * algorithm, and we avoid pulling an npm package into the Worker bundle.
 *
 * Defaults mirror Google Authenticator / 1Password:
 *   - SHA-1 HMAC
 *   - 6 digits
 *   - 30 second step
 */

const DIGITS = 6;
const STEP_SECONDS = 30;

/**
 * Generate a random base32 secret (160 bits = 32 chars). Compatible with
 * every major authenticator app.
 */
export function generateTotpSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return base32Encode(bytes);
}

/**
 * Build an otpauth:// URL that authenticator apps render as a QR code.
 */
export function totpUri(
  secret: string,
  accountName: string,
  issuer: string,
): string {
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(
    accountName,
  )}?${params.toString()}`;
}

/**
 * Verify a code with ±1 window tolerance (clock skew, user typing speed).
 */
export async function verifyTotp(
  secret: string,
  code: string,
  now: number = Date.now(),
): Promise<boolean> {
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;

  const step = Math.floor(now / 1000 / STEP_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const candidate = await generateAt(secret, step + offset);
    if (timingSafeEqual(candidate, normalized)) return true;
  }
  return false;
}

/**
 * Exported for tests — emits the code that would be valid at `step`.
 * Callers should use `verifyTotp` instead for request-path validation.
 */
export async function generateAt(secret: string, step: number): Promise<string> {
  const key = base32Decode(secret);
  // Counter encoded as 8-byte big-endian.
  const counter = new Uint8Array(8);
  let s = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = s & 0xff;
    s = Math.floor(s / 256);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const truncated =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  const mod = truncated % 10 ** DIGITS;
  return mod.toString().padStart(DIGITS, "0");
}

// ─── Backup Codes ──────────────────────────────────────────────────────────

/**
 * Generate N single-use recovery codes (8 hex chars each, user-friendly).
 */
export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    codes.push(
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    );
  }
  return codes;
}

export async function hashBackupCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code.toLowerCase()),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Base32 (RFC 4648) ─────────────────────────────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
