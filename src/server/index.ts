import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, AppVariables } from "./env";
import { createDb } from "./db";
import { ensureTablesExist } from "./db/migrate";
import { authSession } from "./middleware/auth";
import { handleInboundEmail } from "./services/email-inbound";
import { createLogger, generateRequestId } from "./lib/logger";

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
import storageRouter from "./routes/storage";

// ─── Hono App ───────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ─── Global Error Handler ──────────────────────────────────────────────────

app.onError((err, c) => {
  const log = c.get("logger") ?? createLogger({ component: "onError" });
  log.error("unhandled request error", { err, path: c.req.path });
  return c.json({ error: "Internal Server Error", message: err.message }, 500);
});

// ─── Global Middleware ──────────────────────────────────────────────────────

app.use("/*", cors());

// Request-scoped logger + request id. Must run before any other middleware
// that might want to log (including the auth middleware's lazy cleanups).
app.use("/api/*", async (c, next) => {
  const requestId = c.req.header("x-request-id") ?? generateRequestId();
  c.set("requestId", requestId);
  c.set(
    "logger",
    createLogger({
      requestId,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
    }),
  );
  c.header("x-request-id", requestId);
  await next();
});

// Inject Drizzle DB instance + ensure schema is up to date
app.use("/api/*", async (c, next) => {
  await ensureTablesExist(c.env.DB);
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
app.route("/api/storage", storageRouter);

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
    _ctx: ExecutionContext,
  ): Promise<void> {
    await ensureTablesExist(env.DB);
    await handleInboundEmail(message, env);
  },
};
