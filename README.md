# EdgeMail

> Open-source domain email system for Cloudflare Workers — receive, send, and manage emails with your own domain.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/brucx/EdgeMail)

## Features

- 📬 **Custom Domain Email** — receive emails on your own domain via Cloudflare Email Routing
- 📤 **Send Emails** — pick per domain between **Cloudflare Email Service** (no extra vendor, auto SPF/DKIM/DMARC) and **Resend**
- 🌐 **Multi-Domain** — manage multiple domains from a single instance with domain-scoped views
- 📮 **Mailboxes** — create and manage mailboxes
- 🔀 **Aliases** — forward emails to one or more mailboxes
- 👥 **Groups** — distribute emails to a group of mailboxes
- 📎 **Attachments** — upload, store, and download attachments via R2
- 🔐 **Lightweight Auth** — admin login with session-based authentication
- 🔑 **API Tokens** — programmatic access with scoped permissions and domain restrictions
- 🖥️ **Web Inbox** — read, search, and manage emails in a modern web UI
- ☁️ **One-Click Deploy** — deploy to Cloudflare with a single button

## Tech Stack

### Backend
- [Cloudflare Workers](https://workers.cloudflare.com/) — serverless runtime
- [Hono](https://hono.dev/) — ultrafast web framework
- [Drizzle ORM](https://orm.drizzle.team/) — type-safe ORM
- [Cloudflare D1](https://developers.cloudflare.com/d1/) — SQLite database
- [Cloudflare R2](https://developers.cloudflare.com/r2/) — object storage
- [Cloudflare Email Workers](https://developers.cloudflare.com/email-routing/email-workers/) — inbound email processing
- [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) — outbound (optional, recommended on Workers Paid)
- [Resend](https://resend.com/) — outbound (default fallback, free tier friendly)

### Frontend
- [React 19](https://react.dev/) — UI library
- [Vite](https://vite.dev/) — build tool
- [TanStack Router](https://tanstack.com/router/) — type-safe routing
- [TanStack Query](https://tanstack.com/query/) — data fetching
- [Tailwind CSS v4](https://tailwindcss.com/) — utility-first CSS
- [shadcn/ui](https://ui.shadcn.com/) — component library
- [Lucide Icons](https://lucide.dev/) — beautiful icons

### Architecture
- Single Cloudflare Worker serves the API + frontend as static assets
- D1 for all structured data (users, mailboxes, messages, etc.)
- R2 for raw `.eml` files and attachments
- `@cloudflare/vite-plugin` for seamless local dev and production builds

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (Workers Paid plan if you want to send via Cloudflare Email Service; Free plan works for receiving and for sending via Resend)
- [Resend account](https://resend.com/) (free tier: 3,000 emails/month) — only needed when you pick the Resend provider
- A domain added to Cloudflare

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/brucx/EdgeMail.git
cd EdgeMail
npm install
```

### 2. Create Cloudflare Resources

```bash
# Create D1 database
npx wrangler d1 create edgemail-db

# Create R2 bucket
npx wrangler r2 bucket create edgemail-storage
```

Update `wrangler.jsonc` with the D1 `database_id` from the output above.

### 3. Configure Environment

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your Resend API key and a JWT secret.

### 4. Run Migrations

```bash
# Generate migration (already done, but run if you change the schema)
npm run db:generate

# Apply to local D1
npm run db:migrate:local
```

### 5. Start Development

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) to access the admin panel.

### 6. Deploy

```bash
# Apply migrations to remote D1
npm run db:migrate:remote

# Set secrets
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put JWT_SECRET
npx wrangler secret put RESEND_WEBHOOK_SECRET
npx wrangler secret put ENCRYPTION_KEY   # openssl rand -base64 32

# Deploy
npm run deploy
```

Set `ADMIN_EMAIL` as a regular Worker variable in `wrangler.jsonc` or in the Cloudflare dashboard.

### 7. Configure Email Routing

**Option A: Automatic (recommended)** — set up Cloudflare API integration and let EdgeMail configure everything for you:

```bash
# Set Cloudflare API token and account ID
npx wrangler secret put CLOUDFLARE_API_TOKEN
npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
```

Create an API Token at [Cloudflare Dashboard → API Tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Custom Token** with these permissions:

| Scope | Permission | Access | Used for |
|-------|------------|--------|----------|
| Zone (all zones) | Zone | Read | List domains from your CF account |
| Zone (all zones) | DNS | Write | Create/delete MX, SPF, and DKIM records |
| Zone (all zones) | Zone Settings | Write | Enable Email Routing + read DKIM public key |
| Zone (all zones) | Email Routing Rules | Write | Configure catch-all rule → Worker |
| Account | Account Analytics | Read | Storage analytics (D1 & R2 usage) — optional |

Then open EdgeMail → **Settings → Cloudflare** to verify the connection, and use **Import from Cloudflare** on the Domains page to auto-configure everything in one click (MX, SPF, DKIM, Email Routing, catch-all rule).

> **Storage Analytics**: The **Account Analytics: Read** permission is required to view D1 and R2 storage metrics on the **Settings → Storage** page. Without it, the storage dashboard will show a permission error with setup instructions. The analytics data is queried via Cloudflare's [GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/) using the `d1StorageAdaptiveGroups`, `d1AnalyticsAdaptiveGroups`, and `r2StorageAdaptiveGroups` datasets.

**Option B: Manual** — configure in the Cloudflare Dashboard yourself:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → your domain → **Email** → **Email Routing**
2. Enable Email Routing for your domain
3. Under **Routing Rules**, create a **Catch-all** rule pointing to the `edgemail` Worker
4. Configure DNS records as prompted by Cloudflare

## Syncing to a Production Fork

When you maintain a separate production fork (e.g., `edgemail-prod`) with tailored configurations (such as specific D1 IDs, environment variables, or differences in `wrangler.jsonc` and `package.json`), you'll want to sync upstream source changes without inadvertently overwriting your production setup.

**Recommended Workflow using Git Cherry-Pick:**

1. **Add the production repository as a remote**
   ```bash
   git remote add prod git@github.com:your-org/edgemail-prod.git
   git fetch prod
   ```

2. **Create a temporary branch from your production `main`**
   ```bash
   git checkout -b temp-prod prod/main
   ```

3. **Cherry-pick upstream feature and fix commits**
   Find the commit hashes you want to sync using `git log` locally, then pick them onto your temp branch.
   ```bash
   git cherry-pick <commit-hash-1> <commit-hash-2>
   ```

4. **Push back to production and clean up**
   ```bash
   git push prod temp-prod:main
   git checkout main
   git branch -D temp-prod
   ```

## Project Structure

```
EdgeMail/
├── src/
│   ├── client/          # React frontend
│   │   ├── routes/      # TanStack Router file-based routes
│   │   ├── components/  # shadcn/ui-style base components
│   │   └── lib/         # Utilities & API client
│   ├── server/          # Hono backend
│   │   ├── db/schema/   # Drizzle ORM tables
│   │   ├── routes/      # API route handlers
│   │   ├── middleware/   # Auth middleware
│   │   └── services/    # Business logic
│   └── shared/          # Shared types & validation schemas
├── drizzle/             # D1 migration files
├── wrangler.jsonc       # Cloudflare Worker config
├── vite.config.ts       # Vite + Cloudflare plugin config
└── drizzle.config.ts    # Drizzle Kit config
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `RESEND_API_KEY` | Default Resend API key used when a domain has no per-domain override | Only if Resend is used |
| `JWT_SECRET` | Secret for signing session tokens | Yes |
| `ADMIN_EMAIL` | Primary admin email for setup and notifications | Yes |
| `ENCRYPTION_KEY` | Base64-encoded 32-byte AES-GCM key used to encrypt per-domain secrets stored in D1 (`openssl rand -base64 32`) | Yes |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret | For webhooks |
| `APP_NAME` | Display name used by the health endpoint | No |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token for domain auto-setup and storage analytics | No |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID for zone filtering and storage analytics | No |
| `CF_WORKER_NAME` | Worker name for catch-all rule (default: `edgemail`) | No |

Set secret values via `npx wrangler secret put <NAME>` for production, or in `.dev.vars` for local dev.
Use `wrangler.jsonc` or the dashboard for non-secret vars such as `APP_NAME` and `ADMIN_EMAIL`.

## Outbound Provider

Each domain picks one of two providers for outbound mail, configurable via the
`senderProvider` field on the domain record (NULL = auto-pick).

| Provider | How it sends | Pros | Cons |
|----------|--------------|------|------|
| `cloudflare` | `env.EMAIL.send()` via the [`send_email`](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) Worker binding | Auto SPF/DKIM/DMARC; no extra vendor or secret management; cheaper at scale ($0.35 / 1K after 3K/month) | Requires **Workers Paid** for arbitrary recipients (Free / new accounts can only send to verified destination addresses); no delivery webhooks today; 25 MiB / 50-recipient / 16 KB-header per-message caps |
| `resend` | [Resend API](https://resend.com) | Works on Workers Free; delivery + bounce webhooks; 40 MB attachments | Extra vendor; per-domain or global API key must be managed |

**Auto-pick rules** (when the domain leaves `senderProvider` NULL):

1. Prefer `cloudflare` when the `EMAIL` binding is configured.
2. Fall back to `resend` when an API key is available (per-domain override or `RESEND_API_KEY`).
3. Otherwise send returns an error with setup guidance.

### Enabling Cloudflare Email Service

1. Upgrade the account to **Workers Paid** if you plan to send to external recipients.
2. In [Email Service → Domains](https://dash.cloudflare.com/?to=/:account/email/sending/domains), **Onboard Domain** for each sender domain. Cloudflare writes SPF/DKIM/DMARC records automatically under `cf-bounce.<your-domain>`. Wait for the status to turn **Verified** (usually 1–5 minutes).
3. The `send_email` binding is already enabled by default in `wrangler.jsonc`:
   ```jsonc
   "send_email": [{ "name": "EMAIL", "remote": true }]
   ```
   `remote: true` is required so `wrangler dev` routes sends through the live service instead of a local stub. Remove the whole block if you never want the Cloudflare provider.
4. Deploy: `npm run deploy`.
5. In EdgeMail → **Settings → Sending**, each domain row shows an **Onboarded** badge when `cf-bounce._domainkey.<domain>` resolves, or **Not onboarded** if the CF Email Service setup is incomplete. Leave `senderProvider` on `auto` or set it explicitly to `cloudflare`.

### Troubleshooting: recipient shows "sender cannot be verified"

If a test email arrives but the recipient (commonly QQ Mail / 网易 / Outlook) flags it as unauthenticated, pull the raw headers and look at `Authentication-Results`.

**Symptom — domain not onboarded to Email Service:**
```
dkim=fail (No key) header.d=cloudflare-email.com
dmarc=fail (p=REJECT) header.from=<your-domain>
```
This means Cloudflare is falling back to the shared `cloudflare-email.com` DKIM signing domain because the sender domain isn't actually onboarded. The signature then can't align with `header.from` → DMARC fails → strict receivers reject or warn. DNS records being present is not enough; the domain must also appear as **Verified** in **Email Service → Email Sending → Domains**.

**Fix:** Onboard the domain in the CF dashboard (step 2 above). EdgeMail's Sending page will update the per-domain badge once `cf-bounce._domainkey.<domain>` TXT resolves.

> **Heads-up on propagation delay:** right after onboarding, some recipient providers (notably QQ Mail / 163 / other providers with aggressive DNS caches) may still fail DKIM for 5–30 minutes while their recursive resolvers refresh. Gmail / Outlook typically see the new record within 1–2 minutes. If only certain recipients fail while others pass, wait and re-test before assuming misconfiguration.

**Expected headers after onboarding:**
```
dkim=pass  header.d=cf-bounce.<your-domain>
spf=pass   smtp.mailfrom=bounces@cf-bounce.<your-domain>
dmarc=pass header.from=<your-domain>
```

**Note on "Sent by bounces@cf-bounce.… on behalf":** this line that some clients show is normal and not an error — Cloudflare (like AWS SES, Resend, Mailgun) uses a bounce subdomain as the envelope sender to isolate bounce reputation from the main domain. It does not affect DMARC alignment when relaxed mode is used (the default).

### Enabling Resend

1. Create a Resend account and verify the domain via the records Resend provides.
2. Set `RESEND_API_KEY` (global) and/or a per-domain key through EdgeMail → **Domain settings**.
3. Optionally set `RESEND_WEBHOOK_SECRET` and point Resend's webhook at `POST /api/webhooks/resend` for delivery state updates.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/setup/init` | Initialize admin account |
| `GET` | `/api/setup/status` | Check initialization status |
| `POST` | `/api/auth/login` | Admin login |
| `POST` | `/api/auth/logout` | Admin logout |
| `GET` | `/api/auth/me` | Current user info |
| `GET/POST/PATCH/DELETE` | `/api/domains/*` | Domain management |
| `GET/POST/PATCH/DELETE` | `/api/mailboxes/*` | Mailbox management |
| `GET/POST/PATCH/DELETE` | `/api/aliases/*` | Alias management |
| `GET/POST/PATCH/DELETE` | `/api/groups/*` | Group management |
| `GET/PATCH` | `/api/messages/*` | Message list & detail |
| `POST` | `/api/send` | Send email via the domain's configured provider (Resend or Cloudflare Email Service) |
| `GET/POST/DELETE` | `/api/tokens/*` | API token management |
| `POST` | `/api/webhooks/resend` | Resend delivery webhook |
| `GET` | `/api/cloudflare/status` | Check Cloudflare API connection |
| `GET` | `/api/cloudflare/zones` | List Cloudflare zones with EdgeMail mapping |
| `GET` | `/api/cloudflare/zones/:zoneId/dns` | Check existing DNS records |
| `POST` | `/api/cloudflare/zones/:zoneId/setup` | One-click domain email setup |
| `GET` | `/api/storage/stats` | D1 & R2 storage usage analytics |

## Database Schema

14 tables across 5 domains:

- **Auth**: `users`, `sessions`
- **Addressing**: `domains`, `mailboxes`, `aliases`, `alias_targets`, `groups`, `group_members`
- **Messages**: `messages`, `message_recipients`, `message_deliveries`, `attachments`
- **API Access**: `api_tokens`
- **Audit**: `audit_logs`

## R2 Storage Convention

- Raw emails: `raw/{messageId}.eml`
- Attachments: `attachments/{messageId}/{attachmentId}/{filename}`

## Scripts

```bash
npm run dev              # Start local dev server
npm run build            # Production build
npm run deploy           # Build + deploy to Cloudflare
npm run db:generate      # Generate D1 migration from schema
npm run db:migrate:local # Apply migrations to local D1
npm run db:migrate:remote# Apply migrations to remote D1
npm run db:studio        # Open Drizzle Studio
npm run typegen          # Generate Cloudflare binding types
```

## Roadmap

Planned iterations on top of the multi-provider send work already landed:

### Shipped
- **Multi-provider outbound** — Cloudflare Email Service + Resend, per-domain selection (this PR)

### Next up
- **Email threading** — `messageIdHeader`, `inReplyTo`, `references`, `threadId`, and `normalizedSubject` on `messages`; `GET /api/messages/threads/:threadId`; conversation view in the UI. Informed by the Cloudflare [Agentic Inbox](https://github.com/cloudflare/agentic-inbox) reference.
- **Inbound auto-reply** — per-mailbox `autoReplyEnabled` + subject/body with `Auto-Submitted` header loop-prevention.
- **One-click Cloudflare sending** — extend `/api/cloudflare/zones/:zoneId/setup` to also add the domain to Email Service so users only click once to receive + send.

### Future (not started)
- **AI agent + MCP server** — optional module that adds (a) an AI-drafted reply on inbound mail, (b) a `/mcp` endpoint that exposes mailbox tools (list/get/search/draft/send) to Claude Code, Cursor, and other MCP clients, with prompt-injection scanning and draft verification on Workers AI. Gated behind an `AI` binding so the core product stays slim; opt-in per mailbox. See `~/code/agentic-inbox` for the reference implementation this draws from.

## License

MIT © [Noodles](LICENSE)
