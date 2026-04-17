import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { resolveMailer, MailerError } from "../services/mailer";
import { getSendCapabilities } from "../services/mailer/capabilities";
import { encryptSecret } from "../lib/crypto";

// Build a fake SendEmail binding so we can inspect the payload without hitting
// Cloudflare. The binding type only requires `send()`.
function makeFakeBinding() {
  const calls: unknown[] = [];
  const binding: SendEmail = {
    async send(msg: unknown) {
      calls.push(msg);
      return { messageId: "cf-message-id" };
    },
  } as unknown as SendEmail;
  return { binding, calls };
}

describe("resolveMailer", () => {
  it("uses Cloudflare when the binding is present and no override is set", async () => {
    const { binding } = makeFakeBinding();
    const envWithBinding = { ...env, EMAIL: binding } as typeof env;
    const mailer = await resolveMailer(envWithBinding, {
      senderProvider: null,
      resendApiKey: null,
    });
    expect(mailer.provider).toBe("cloudflare");
  });

  it("falls back to Resend when no binding is present but a key is configured", async () => {
    const envNoBinding = { ...env, EMAIL: undefined, RESEND_API_KEY: "re_test_key" } as typeof env;
    const mailer = await resolveMailer(envNoBinding, {
      senderProvider: null,
      resendApiKey: null,
    });
    expect(mailer.provider).toBe("resend");
  });

  it("honours an explicit resend preference even when the CF binding exists", async () => {
    const { binding } = makeFakeBinding();
    const envBoth = { ...env, EMAIL: binding, RESEND_API_KEY: "re_test_key" } as typeof env;
    const mailer = await resolveMailer(envBoth, {
      senderProvider: "resend",
      resendApiKey: null,
    });
    expect(mailer.provider).toBe("resend");
  });

  it("throws a user-visible error when cloudflare is requested but unbound", async () => {
    const envNoBinding = { ...env, EMAIL: undefined } as typeof env;
    await expect(
      resolveMailer(envNoBinding, { senderProvider: "cloudflare", resendApiKey: null }),
    ).rejects.toMatchObject({
      name: "MailerError",
      provider: "cloudflare",
      userVisible: true,
    });
  });

  it("throws when neither provider is available", async () => {
    const empty = { ...env, EMAIL: undefined, RESEND_API_KEY: "" } as typeof env;
    await expect(
      resolveMailer(empty, { senderProvider: null, resendApiKey: null }),
    ).rejects.toBeInstanceOf(MailerError);
  });

  it("decrypts per-domain Resend keys", async () => {
    const plaintext = "re_percdomain_key";
    const ciphertext = await encryptSecret(plaintext, env.ENCRYPTION_KEY);
    const envNoBinding = { ...env, EMAIL: undefined, RESEND_API_KEY: "re_global" } as typeof env;
    const mailer = await resolveMailer(envNoBinding, {
      senderProvider: "resend",
      resendApiKey: ciphertext,
    });
    expect(mailer.provider).toBe("resend");
    // We can't easily peek at the internal Resend client key, but the fact
    // that resolveMailer did not throw means decryption succeeded.
  });
});

describe("getSendCapabilities", () => {
  it("reports binding-missing clearly when EMAIL is not bound", async () => {
    const noBinding = { ...env, EMAIL: undefined } as typeof env;
    const caps = await getSendCapabilities(noBinding, 0);
    expect(caps.cloudflare.bindingConfigured).toBe(false);
    expect(caps.cloudflare.accountStatus).toBe("unknown");
    expect(caps.cloudflare.message).toMatch(/wrangler/i);
  });

  it("returns accountStatus=unknown when no CF API token is set", async () => {
    const binding: SendEmail = {
      async send() {
        return { messageId: "x" };
      },
    } as unknown as SendEmail;
    const envWithBinding = {
      ...env,
      EMAIL: binding,
      CLOUDFLARE_API_TOKEN: undefined,
      CLOUDFLARE_ACCOUNT_ID: undefined,
    } as typeof env;
    const caps = await getSendCapabilities(envWithBinding, 0);
    expect(caps.cloudflare.bindingConfigured).toBe(true);
    expect(caps.cloudflare.accountStatus).toBe("unknown");
  });

  it("marks resend as ready when a global key is set", async () => {
    const envWithResend = {
      ...env,
      EMAIL: undefined,
      RESEND_API_KEY: "re_real_key",
    } as typeof env;
    const caps = await getSendCapabilities(envWithResend, 0);
    expect(caps.resend.globalConfigured).toBe(true);
    expect(caps.defaultProvider).toBe("resend");
  });

  it("marks resend as not configured when RESEND_API_KEY is a placeholder", async () => {
    const envPlaceholder = {
      ...env,
      EMAIL: undefined,
      RESEND_API_KEY: "YOUR_RESEND_KEY_HERE",
    } as typeof env;
    const caps = await getSendCapabilities(envPlaceholder, 0);
    expect(caps.resend.globalConfigured).toBe(false);
    expect(caps.defaultProvider).toBe("none");
  });
});
