import { Resend } from "resend";
import {
  MailerError,
  type Mailer,
  type MailerSendInput,
  type MailerSendResult,
} from "./types";

/**
 * Resend-backed mailer. Wraps the `resend` SDK and normalises the response
 * shape into MailerSendResult. The API key is resolved by the caller (per-domain
 * override or global env fallback) so this class is stateless beyond the key.
 */
export class ResendMailer implements Mailer {
  readonly provider = "resend" as const;
  private readonly client: Resend;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new MailerError(
        "Resend API key is empty",
        true,
        "resend",
      );
    }
    this.client = new Resend(apiKey);
  }

  async send(input: MailerSendInput): Promise<MailerSendResult> {
    // Threading is conveyed via custom headers; Resend's typed payload doesn't
    // expose dedicated In-Reply-To / References fields.
    const headers: Record<string, string> = {};
    if (input.inReplyTo) {
      headers["In-Reply-To"] = `<${input.inReplyTo}>`;
    }
    if (input.references && input.references.length > 0) {
      headers["References"] = input.references.map((r) => `<${r}>`).join(" ");
    }

    const fromHeader = input.fromName
      ? `${input.fromName} <${input.from}>`
      : input.from;

    const result = await this.client.emails.send({
      from: fromHeader,
      to: input.to,
      cc: input.cc && input.cc.length > 0 ? input.cc : undefined,
      bcc: input.bcc && input.bcc.length > 0 ? input.bcc : undefined,
      subject: input.subject,
      html: input.html || undefined,
      text: input.text || undefined,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    } as Parameters<typeof this.client.emails.send>[0]);

    if (result.error) {
      throw new MailerError(result.error.message, true, "resend");
    }

    return {
      providerMessageId: result.data?.id ?? null,
      provider: "resend",
    };
  }
}
