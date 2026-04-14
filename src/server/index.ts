import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, AppVariables } from "./env";
import { createDb } from "./db";
import { ensureTablesExist } from "./db/migrate";
import { authSession } from "./middleware/auth";
import { handleInboundEmail } from "./services/email-inbound";

// Route modules
import setup from "./routes/setup";
import auth from "./routes/auth";
import domainsRouter from "./routes/domains";
import mailboxesRouter from "./routes/mailboxes";
import aliasesRouter from "./routes/aliases";
import groupsRouter from "./routes/groups";
import messagesRouter from "./routes/messages";
import sendRouter from "./routes/send";
import tokensRouter from "./routes/tokens";
import webhooksRouter from "./routes/webhooks";
import cloudflareRouter from "./routes/cloudflare";

// ─── Hono App ───────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ─── Global Error Handler ──────────────────────────────────────────────────

app.onError((err, c) => {
  console.error("[EdgeMail] Unhandled error:", err.message, err.stack);
  return c.json({ error: "Internal Server Error", message: err.message }, 500);
});

// ─── Global Middleware ──────────────────────────────────────────────────────

app.use("/*", cors());

// Inject Drizzle DB instance into every request
app.use("/api/*", async (c, next) => {
  const db = createDb(c.env.DB);
  c.set("db", db);

  return next();
});

// Session validation (sets userId/sessionId in context, does NOT block)
app.use("/api/*", authSession);

// ─── Health Check ───────────────────────────────────────────────────────────

app.get("/api/health", (c) => {
  return c.json({
    status: "ok",
    name: c.env.APP_NAME || "EdgeMail",
    timestamp: new Date().toISOString(),
  });
});

// ─── API Routes ─────────────────────────────────────────────────────────────

app.route("/api/setup", setup);
app.route("/api/auth", auth);
app.route("/api/domains", domainsRouter);
app.route("/api/mailboxes", mailboxesRouter);
app.route("/api/aliases", aliasesRouter);
app.route("/api/groups", groupsRouter);
app.route("/api/messages", messagesRouter);
app.route("/api/send", sendRouter);
app.route("/api/tokens", tokensRouter);
app.route("/api/webhooks", webhooksRouter);
app.route("/api/cloudflare", cloudflareRouter);

// ─── Worker Export ──────────────────────────────────────────────────────────

export default {
  fetch: app.fetch,

  /**
   * Email Worker handler — receives inbound emails via Cloudflare Email Routing.
   * Configure a catch-all route in your domain's Email Routing settings
   * to forward all mail to this Worker.
   */
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    await handleInboundEmail(message, env);
  },
};
