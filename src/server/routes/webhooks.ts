import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env, AppVariables } from "../env";
import { createDb } from "../db";
import { messages } from "../db/schema";

const webhooksRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/**
 * POST /api/webhooks/resend
 * Resend webhook callback for delivery status updates.
 * Events: email.sent, email.delivered, email.bounced, email.complained, etc.
 *
 * NOTE: This endpoint is NOT behind auth middleware — it uses
 * Resend's webhook signature verification instead.
 */
webhooksRouter.post("/resend", async (c) => {
  const webhookSecret = c.env.RESEND_WEBHOOK_SECRET;

  // Verify webhook signature
  const svixId = c.req.header("svix-id");
  const svixTimestamp = c.req.header("svix-timestamp");
  const svixSignature = c.req.header("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return c.json({ error: "Missing webhook signature headers" }, 401);
  }

  // Basic timestamp validation (prevent replay attacks)
  const timestamp = parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  const tolerance = 300; // 5 minutes
  if (Math.abs(now - timestamp) > tolerance) {
    return c.json({ error: "Webhook timestamp too old" }, 401);
  }

  // Verify HMAC signature
  const body = await c.req.text();

  if (webhookSecret) {
    const signedContent = `${svixId}.${svixTimestamp}.${body}`;
    // Resend uses base64-encoded secret with "whsec_" prefix
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

    // Resend sends multiple signatures separated by spaces: "v1,<sig1> v1,<sig2>"
    const signatures = svixSignature.split(" ");
    const isValid = signatures.some((sig) => {
      const [, value] = sig.split(",");
      return value === expectedSignature;
    });

    if (!isValid) {
      return c.json({ error: "Invalid webhook signature" }, 401);
    }
  }

  // Process event
  const event = JSON.parse(body);
  const db = createDb(c.env.DB);

  console.log(`[EdgeMail] Webhook event: ${event.type}`, event.data?.email_id);

  // We could update delivery status here if we stored the Resend email ID.
  // For now, just log the event.
  // Future: match event.data.email_id → messages.messageId → update status

  return c.json({ received: true });
});

export default webhooksRouter;
