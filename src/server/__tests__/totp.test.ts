import { describe, it, expect } from "vitest";
import {
  generateTotpSecret,
  totpUri,
  verifyTotp,
  generateAt,
  generateBackupCodes,
  hashBackupCode,
} from "../lib/totp";

const STEP_SECONDS = 30;

describe("TOTP", () => {
  it("generates base32 secrets accepted by authenticator apps", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
  });

  it("round-trips: a code generated now verifies now", async () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = Math.floor(now / 1000 / STEP_SECONDS);
    const code = await generateAt(secret, step);
    expect(await verifyTotp(secret, code, now)).toBe(true);
  });

  it("tolerates ±1 time step skew", async () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = Math.floor(now / 1000 / STEP_SECONDS);
    const prevCode = await generateAt(secret, step - 1);
    const nextCode = await generateAt(secret, step + 1);
    expect(await verifyTotp(secret, prevCode, now)).toBe(true);
    expect(await verifyTotp(secret, nextCode, now)).toBe(true);
  });

  it("rejects codes outside the ±1 window", async () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = Math.floor(now / 1000 / STEP_SECONDS);
    const farCode = await generateAt(secret, step + 5);
    expect(await verifyTotp(secret, farCode, now)).toBe(false);
  });

  it("rejects non-6-digit inputs", async () => {
    const secret = generateTotpSecret();
    expect(await verifyTotp(secret, "abcdef")).toBe(false);
    expect(await verifyTotp(secret, "12345")).toBe(false);
    expect(await verifyTotp(secret, "")).toBe(false);
  });

  it("emits a valid otpauth URI", () => {
    const uri = totpUri("JBSWY3DPEHPK3PXP", "alice@example.com", "EdgeMail");
    expect(uri).toMatch(/^otpauth:\/\/totp\/EdgeMail:alice%40example\.com\?/);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("algorithm=SHA1");
  });

  it("matches the RFC 6238 reference vector (Section 5.2)", async () => {
    // RFC 6238 test: secret "12345678901234567890" in base32 =
    // GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ. Time 59 → step 1 → code 94287082
    // (but that's SHA-512 in the RFC; for SHA-1 it's 287082 at 6 digits).
    const secretAscii = "12345678901234567890";
    const secretBytes = new TextEncoder().encode(secretAscii);
    const secret = bytesToBase32(secretBytes);
    const code = await generateAt(secret, 1);
    expect(code).toBe("287082");
  });
});

describe("backup codes", () => {
  it("hashes are case-insensitive and deterministic", async () => {
    expect(await hashBackupCode("ABC123")).toBe(await hashBackupCode("abc123"));
  });
  it("distinct codes hash differently", async () => {
    const [a, b] = generateBackupCodes(2);
    expect(await hashBackupCode(a)).not.toBe(await hashBackupCode(b));
  });
});

// Local base32 encoder for the RFC 6238 vector test. (Avoids having to
// also export the internal one.)
function bytesToBase32(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 0x1f];
  return out;
}
