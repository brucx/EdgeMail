import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { Env, AppVariables } from "../env";
import { users, auditLogs, pending2fa } from "../db/schema";
import {
  encryptSecret,
  decryptSecret,
  verifyPassword,
  type PasswordAlgo,
} from "../lib/crypto";
import {
  generateTotpSecret,
  totpUri,
  verifyTotp,
  generateBackupCodes,
  hashBackupCode,
} from "../lib/totp";
import { generateId } from "../lib/id";
import { requireAuth } from "../middleware/auth";
import { issueSession } from "./auth";

const twoFactor = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ─── Setup: issue new secret + URI ────────────────────────────────────────

const setupSchema = z.object({
  password: z.string().min(8),
});

/**
 * POST /api/auth/2fa/setup
 * Generate (but do not activate) a new TOTP secret. The client displays the
 * URI as a QR code, the user confirms with a valid code via /verify-setup.
 */
twoFactor.post(
  "/setup",
  requireAuth,
  zValidator("json", setupSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const userId = c.get("userId")!;
    const { password } = c.req.valid("json");

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((r) => r[0]);
    if (!user) return c.json({ error: "User not found" }, 404);

    const algo = (user.passwordAlgo as PasswordAlgo | null) ?? "hmac-sha256-10k";
    if (!(await verifyPassword(password, user.passwordHash, algo))) {
      return c.json({ error: "Invalid password" }, 401);
    }

    const secret = generateTotpSecret();
    const uri = totpUri(secret, user.email, c.env.APP_NAME || "EdgeMail");

    if (!c.env.ENCRYPTION_KEY) {
      return c.json({ error: "ENCRYPTION_KEY not configured on server" }, 500);
    }
    const encSecret = await encryptSecret(secret, c.env.ENCRYPTION_KEY);

    // Store provisional secret; it becomes live only after /verify-setup.
    // We reuse the same column — totpEnabled=false means "secret set but
    // not activated yet", which is the desired state between the two calls.
    await db
      .update(users)
      .set({
        totpSecretEnc: encSecret,
        totpEnabled: false,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));

    return c.json({
      data: { secret, uri },
      message: "Scan the QR code in your authenticator app, then confirm with a code.",
    });
  },
);

// ─── Verify setup: activate TOTP + emit backup codes ──────────────────────

const verifySetupSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

twoFactor.post(
  "/verify-setup",
  requireAuth,
  zValidator("json", verifySetupSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const userId = c.get("userId")!;
    const { code } = c.req.valid("json");

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((r) => r[0]);
    if (!user || !user.totpSecretEnc) {
      return c.json({ error: "No pending 2FA setup found. Call /setup first." }, 400);
    }
    if (user.totpEnabled) {
      return c.json({ error: "2FA is already enabled. Disable it first to re-enroll." }, 409);
    }

    const secret = await decryptSecret(user.totpSecretEnc, c.env);
    if (!(await verifyTotp(secret, code))) {
      return c.json({ error: "Invalid code" }, 401);
    }

    const backupCodes = generateBackupCodes(8);
    const hashed = await Promise.all(backupCodes.map(hashBackupCode));
    const backupEnc = await encryptSecret(
      JSON.stringify(hashed),
      c.env.ENCRYPTION_KEY,
    );

    await db
      .update(users)
      .set({
        totpEnabled: true,
        backupCodesEnc: backupEnc,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));

    await db.insert(auditLogs).values({
      id: generateId(),
      userId,
      action: "user.2fa_enabled",
      resourceType: "user",
      resourceId: userId,
    });

    return c.json({
      data: { backupCodes },
      message: "2FA enabled. Save these backup codes — they won't be shown again.",
    });
  },
);

// ─── Login-time verify ────────────────────────────────────────────────────

const verifyLoginSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().min(1),
});

/**
 * POST /api/auth/2fa/verify
 * Exchange a pending-2fa challenge + TOTP (or backup) code for a real session.
 */
twoFactor.post(
  "/verify",
  zValidator("json", verifyLoginSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const { challengeId, code } = c.req.valid("json");
    const now = new Date().toISOString();

    const challenge = await db
      .select()
      .from(pending2fa)
      .where(and(eq(pending2fa.id, challengeId), gt(pending2fa.expiresAt, now)))
      .limit(1)
      .then((r) => r[0]);
    if (!challenge) {
      return c.json({ error: "Challenge not found or expired. Log in again." }, 401);
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, challenge.userId))
      .limit(1)
      .then((r) => r[0]);
    if (!user || !user.totpEnabled || !user.totpSecretEnc) {
      return c.json({ error: "2FA not configured for this account" }, 400);
    }

    const secret = await decryptSecret(user.totpSecretEnc, c.env);

    let accepted = false;
    let usedBackupIdx: number | null = null;

    if (/^\d{6}$/.test(code.replace(/\s+/g, ""))) {
      accepted = await verifyTotp(secret, code);
    }

    if (!accepted && user.backupCodesEnc) {
      const codesJson = await decryptSecret(user.backupCodesEnc, c.env);
      const codes = JSON.parse(codesJson) as string[];
      const incomingHash = await hashBackupCode(code);
      usedBackupIdx = codes.findIndex((h) => h === incomingHash);
      if (usedBackupIdx >= 0) {
        accepted = true;
        codes.splice(usedBackupIdx, 1);
        const newEnc = await encryptSecret(JSON.stringify(codes), c.env.ENCRYPTION_KEY);
        await db
          .update(users)
          .set({ backupCodesEnc: newEnc, updatedAt: new Date().toISOString() })
          .where(eq(users.id, user.id));
      }
    }

    if (!accepted) {
      return c.json({ error: "Invalid code" }, 401);
    }

    // Consume the challenge.
    await db.delete(pending2fa).where(eq(pending2fa.id, challengeId));

    await db.insert(auditLogs).values({
      id: generateId(),
      userId: user.id,
      action: usedBackupIdx !== null ? "user.2fa_backup_used" : "user.2fa_login",
      resourceType: "user",
      resourceId: user.id,
    });

    return await issueSession(c, user.id, user.email, user.displayName, user.role);
  },
);

// ─── Disable ──────────────────────────────────────────────────────────────

const disableSchema = z.object({
  password: z.string().min(8),
});

twoFactor.post(
  "/disable",
  requireAuth,
  zValidator("json", disableSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        { error: "Validation failed", details: result.error.flatten() },
        400,
      );
    }
  }),
  async (c) => {
    const db = c.get("db");
    const userId = c.get("userId")!;
    const { password } = c.req.valid("json");

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .then((r) => r[0]);
    if (!user) return c.json({ error: "User not found" }, 404);

    const algo = (user.passwordAlgo as PasswordAlgo | null) ?? "hmac-sha256-10k";
    if (!(await verifyPassword(password, user.passwordHash, algo))) {
      return c.json({ error: "Invalid password" }, 401);
    }

    await db
      .update(users)
      .set({
        totpEnabled: false,
        totpSecretEnc: null,
        backupCodesEnc: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));

    // Burn any in-flight 2FA challenges for this user.
    await db.delete(pending2fa).where(eq(pending2fa.userId, userId));

    await db.insert(auditLogs).values({
      id: generateId(),
      userId,
      action: "user.2fa_disabled",
      resourceType: "user",
      resourceId: userId,
    });

    return c.json({ message: "2FA disabled" });
  },
);

export default twoFactor;
