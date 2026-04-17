import {
  MailerError,
  type Mailer,
  type MailerSendInput,
  type MailerSendResult,
} from "./types";

/**
 * Cloudflare Email Service mailer.
 *
 * Uses the `send_email` Worker binding (`env.EMAIL.send()`). The high-level
 * builder form lets us pass `to/from/subject/html/text/headers` directly —
 * no MIME construction needed.
 *
 * See: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 *
 * Limits to be aware of (enforced by Cloudflare, not here):
 *   - 50 recipients per email (to + cc + bcc combined)
 *   - 25 MiB total message size (including attachments)
 *   - 16 KB header size
 *   - Account-level daily sending limits
 *
 * Free / new accounts can only send to verified destination addresses.
 * Workers Paid accounts can send to any recipient.
 */
export class CloudflareMailer implements Mailer {
  readonly provider = "cloudflare" as const;

  constructor(private readonly binding: SendEmail) {}

  async send(input: MailerSendInput): Promise<MailerSendResult> {
    const headers: Record<string, string> = {};
    if (input.inReplyTo) {
      headers["In-Reply-To"] = `<${input.inReplyTo}>`;
    }
    if (input.references && input.references.length > 0) {
      headers["References"] = input.references.map((r) => `<${r}>`).join(" ");
    }

    const from = input.fromName
      ? { email: input.from, name: input.fromName }
      : input.from;

    let result: EmailSendResult | undefined;
    try {
      result = await this.binding.send({
        from,
        to: input.to,
        cc: input.cc && input.cc.length > 0 ? input.cc : undefined,
        bcc: input.bcc && input.bcc.length > 0 ? input.bcc : undefined,
        subject: input.subject,
        ...(input.html ? { html: input.html } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new MailerError(explainCloudflareError(message), true, "cloudflare");
    }

    // `wrangler dev` without `remote: true` on the send_email binding returns
    // undefined instead of an EmailSendResult, so reading `.messageId` would
    // blow up with a cryptic TypeError. Treat that case explicitly.
    if (!result) {
      throw new MailerError(
        "Cloudflare Email Service binding returned no result. If this happened in `wrangler dev`, make sure `send_email` has `remote: true` in wrangler.jsonc so the local runtime routes to the real service.",
        true,
        "cloudflare",
      );
    }

    return {
      providerMessageId: result.messageId ?? null,
      provider: "cloudflare",
    };
  }
}

/**
 * Rewrite raw binding errors into messages that tell the operator what to do.
 * The CF Email Service error surface isn't a stable contract, so we pattern-
 * match on keywords rather than any formal code.
 */
function explainCloudflareError(raw: string): string {
  const lower = raw.toLowerCase();

  if (lower.includes("paid") && lower.includes("plan")) {
    return "Cloudflare Email Service send failed: this account is on Workers Free, which cannot send to external recipients. Upgrade to Workers Paid, or switch the domain to the Resend provider and set a Resend API key. (Raw error: " + raw + ")";
  }
  if (lower.includes("not verified") || lower.includes("verify")) {
    return "Cloudflare Email Service rejected the recipient because the destination address is not verified. On Workers Free you can only send to destinations verified in Email Routing. Verify the address in the Cloudflare dashboard, upgrade to Workers Paid, or switch to Resend. (Raw error: " + raw + ")";
  }
  if (lower.includes("not enabled") || lower.includes("email service") || lower.includes("email routing")) {
    return "Cloudflare Email Service is not enabled for the sender domain. In the Cloudflare dashboard go to Email → Sending → Domains and add the domain (SPF/DKIM/DMARC are configured automatically). (Raw error: " + raw + ")";
  }
  if (lower.includes("rate limit") || lower.includes("daily limit") || lower.includes("quota")) {
    return "Cloudflare Email Service daily sending limit reached. Wait until the limit resets or contact Cloudflare Support for a higher cap. (Raw error: " + raw + ")";
  }

  return `Cloudflare Email Service send failed: ${raw}`;
}
