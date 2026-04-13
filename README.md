# EdgeMail

> Open-source domain email system for Cloudflare Workers — receive, send, and manage emails with your own domain.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/brucx/EdgeMail)

## Features

- 📬 **Custom Domain Email** — receive emails on your own domain via Cloudflare Email Routing
- 📤 **Send Emails** — send from your domain using Resend
- 📮 **Mailboxes** — create and manage mailboxes
- 🔀 **Aliases** — forward emails to one or more mailboxes
- 👥 **Groups** — distribute emails to a group of mailboxes
- 📎 **Attachments** — upload, store, and download attachments via R2
- 🔐 **Lightweight Auth** — admin login with session-based authentication
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
- [Resend](https://resend.com/) — outbound email API

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
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free plan works)
- [Resend account](https://resend.com/) (free tier: 3,000 emails/month)
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

# Deploy
npm run deploy
```

Set `ADMIN_EMAIL` as a regular Worker variable in `wrangler.jsonc` or in the Cloudflare dashboard.

### 7. Configure Email Routing

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) → your domain → **Email** → **Email Routing**
2. Enable Email Routing for your domain
3. Under **Routing Rules**, create a **Catch-all** rule pointing to the `edgemail` Worker
4. Configure DNS records as prompted by Cloudflare

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
| `RESEND_API_KEY` | Resend API key for sending emails | Yes |
| `JWT_SECRET` | Secret for signing session tokens | Yes |
| `ADMIN_EMAIL` | Primary admin email for setup and notifications | Yes |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signing secret | For webhooks |
| `APP_NAME` | Display name used by the health endpoint | No |

Set secret values via `npx wrangler secret put <NAME>` for production, or in `.dev.vars` for local dev.
Use `wrangler.jsonc` or the dashboard for non-secret vars such as `APP_NAME` and `ADMIN_EMAIL`.

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
| `POST` | `/api/send` | Send email via Resend |
| `POST` | `/api/webhooks/resend` | Resend delivery webhook |

## Database Schema

13 tables across 4 domains:

- **Auth**: `users`, `sessions`
- **Addressing**: `domains`, `mailboxes`, `aliases`, `alias_targets`, `groups`, `group_members`
- **Messages**: `messages`, `message_recipients`, `message_deliveries`, `attachments`
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

## License

MIT © [Noodles](LICENSE)
