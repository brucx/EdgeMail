import type { Env } from "../../env";
import { decryptSecret } from "../../lib/crypto";
import { CloudflareMailer } from "./cloudflare";
import { ResendMailer } from "./resend";
import {
  MailerError,
  type Mailer,
  type MailerProvider,
} from "./types";

export {
  MailerError,
  type Mailer,
  type MailerProvider,
  type MailerSendInput,
  type MailerSendResult,
} from "./types";

interface DomainSenderConfig {
  /** Per-domain provider preference. NULL = auto-select. */
  senderProvider: MailerProvider | null;
  /** Encrypted Resend API key (AES-GCM ciphertext). NULL = use global env key. */
  resendApiKey: string | null;
}

/**
 * Pick a mailer for the given domain. Selection rules:
 *
 *   1. If the domain explicitly sets `senderProvider`, honour it.
 *   2. Otherwise prefer Cloudflare when the binding is available, since it
 *      requires no per-tenant secret management.
 *   3. Fall back to Resend when only an API key is available.
 *
 * Throws MailerError with a user-visible message when neither path can be
 * satisfied (e.g. provider explicitly set to "cloudflare" but binding missing).
 */
export async function resolveMailer(
  env: Env,
  domain: DomainSenderConfig,
): Promise<Mailer> {
  const cloudflareReady = Boolean(env.EMAIL);
  const resendReady = Boolean(domain.resendApiKey || env.RESEND_API_KEY);

  let provider: MailerProvider;
  if (domain.senderProvider) {
    provider = domain.senderProvider;
  } else if (cloudflareReady) {
    provider = "cloudflare";
  } else if (resendReady) {
    provider = "resend";
  } else {
    throw new MailerError(
      "No email sender is configured. Bind Cloudflare Email Service (`send_email`) or set RESEND_API_KEY.",
      true,
      "resend",
    );
  }

  if (provider === "cloudflare") {
    if (!env.EMAIL) {
      throw new MailerError(
        "Domain prefers Cloudflare Email Service, but the `EMAIL` (`send_email`) binding is not configured on this Worker.",
        true,
        "cloudflare",
      );
    }
    return new CloudflareMailer(env.EMAIL);
  }

  // provider === "resend"
  let apiKey = env.RESEND_API_KEY;
  if (domain.resendApiKey) {
    if (!env.ENCRYPTION_KEY) {
      throw new MailerError(
        "Server is misconfigured: ENCRYPTION_KEY is required to use per-domain Resend keys.",
        false,
        "resend",
      );
    }
    apiKey = await decryptSecret(domain.resendApiKey, env);
  }
  if (!apiKey) {
    throw new MailerError(
      "No Resend API key is configured for this domain or globally.",
      true,
      "resend",
    );
  }
  return new ResendMailer(apiKey);
}
