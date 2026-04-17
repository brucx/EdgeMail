/**
 * Mailer provider abstraction.
 *
 * Two providers are supported today:
 *   - "resend"     — third-party transactional email API (existing).
 *   - "cloudflare" — Cloudflare Email Service via the `send_email` Worker
 *                    binding. Requires Workers Paid plan to send to arbitrary
 *                    recipients; on Free / new accounts only verified
 *                    destinations are accepted.
 */

export type MailerProvider = "resend" | "cloudflare";

export interface MailerSendInput {
  from: string;
  fromName?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html?: string;
  text?: string;
  /** RFC 5322 Message-ID this email is replying to (without angle brackets). */
  inReplyTo?: string;
  /** Prior Message-IDs in the thread (without angle brackets). */
  references?: string[];
}

export interface MailerSendResult {
  /** The provider's own Message-ID, if any. May be null when the provider
   *  does not return one (or returns it later via webhook). */
  providerMessageId: string | null;
  provider: MailerProvider;
}

export class MailerError extends Error {
  constructor(
    message: string,
    /** True for misconfiguration / 4xx-style errors that the user can fix. */
    readonly userVisible: boolean,
    readonly provider: MailerProvider,
  ) {
    super(message);
    this.name = "MailerError";
  }
}

export interface Mailer {
  readonly provider: MailerProvider;
  send(input: MailerSendInput): Promise<MailerSendResult>;
}
