import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { createDb } from "../db";
import { messages } from "../db/schema";
import { createLogger } from "../lib/logger";

const webhooksRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/**
 * Maps Resend event types to our `messages.deliveryStatus` values.
 * Unknown events fall through unchanged so the webhook ack stays 200.
 */
const EVENT_STATUS_MAP: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "delivered", // treat open as confirmation of delivery
  "email.clicked": "delivered",
  "email.failed": "failed",
};

/**
 * POST /api/webhooks/resend
 * Resend webhook callback for delivery status updates.
 * Verified via Svix HMAC signature — NOT behind auth middleware.
 */
webhooksRouter.post("/resend", async (c) => {
  const log = c.get("logger") ?? createLogger({ component: "webhook-resend" });
  const webhookSecret = c.env.RESEND_WEBHOOK_SECRET;

  const svixId = c.req.header("svix-id");
  const svixTimestamp = c.req.header("svix-timestamp");
  const svixSignature = c.req.header("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: "Missing webhook signature headers" }, 401);
  }

  const timestamp = parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    return c.json({ error: "Webhook timestamp too old" }, 401);
  }

  const body = await c.req.text();

  if (webhookSecret) {
    const signedContent = `${svixId}.${svixTimestamp}.${body}`;
    const secretBytes = Uint8Array.from(
      atob(webhookSecret.replace("whsec_", "")),
      (ch) => ch.charCodeAt(0),
    );
    const key = await crypto.subtle.importKey(
      "raw",
      secretBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(signedContent),
    );
    const expectedSignature = btoa(
      String.fromCharCode(...new Uint8Array(signatureBytes)),
    );
    const signatures = svixSignature.split(" ");
    const isValid = signatures.some((sig) => {
      const [, value] = sig.split(",");
      return value === expectedSignature;
    });
    if (!isValid) {
      return c.json({ error: "Invalid webhook signature" }, 401);
    }
  }

  interface ResendEvent {
    type?: string;
    data?: {
      email_id?: string;
      bounce?: { message?: string };
      complaint?: { message?: string };
      failure?: { reason?: string };
    };
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const resendEmailId = event.data?.email_id;
  const status = event.type ? EVENT_STATUS_MAP[event.type] : undefined;

  if (!resendEmailId || !status) {
    log.info("webhook event ignored", { type: event.type, hasId: !!resendEmailId });
    return c.json({ received: true });
  }

  // Resend's `email_id` is the value we stored in `messages.messageId` when
  // we sent the mail. Look it up and update delivery status.
  const db = createDb(c.env.DB);

  const error =
    event.data?.bounce?.message ??
    event.data?.complaint?.message ??
    event.data?.failure?.reason ??
    null;

  const update = await db
    .update(messages)
    .set({
      deliveryStatus: status,
      deliveryError: error,
      deliveryUpdatedAt: new Date().toISOString(),
    })
    .where(eq(messages.messageId, resendEmailId))
    .returning({ id: messages.id });

  log.info("webhook status applied", {
    type: event.type,
    status,
    matched: update.length,
    resendEmailId,
  });

  return c.json({ received: true, updated: update.length });
});

export default webhooksRouter;
