# Referral CRM (AFC and AHA)

Referral CRM is a Next.js 14 application for managing the full referral lifecycle between AFC mortgage consultants and AHA agents. It includes referral intake and assignment, dashboards, payment tracking, task automation, imports, and operational APIs for email/webhook/cron workflows.

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Scripts and Commands](#scripts-and-commands)
- [Testing](#testing)
- [API Overview](#api-overview)
- [Deployment and Operations](#deployment-and-operations)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Additional Docs](#additional-docs)

## Overview

This project supports collaboration across referral stakeholders:

- **AFC mortgage consultants** create and route referrals.
- **AHA / AHA_OOS agents** manage the deal workflow.
- **Admins and managers** monitor performance, SLAs, and operations.

Typical flow:

1. Referral is created (manual, API, or inbound email).
2. Agent/lender assignment is handled.
3. Status changes and activities are tracked.
4. Payments and fee workflows are managed.
5. Dashboards and admin tools provide reporting and intervention.

## Key Features

- Referral lifecycle management with assignment, notes, status, and activities
- Role-aware dashboards (`Main`, `MC`, `Agent`, `Admin`, `AGIT`)
- Revenue and payment workflows, including fee-breakdown email operations
- Admin task board and reminder automation
- Inbound email ingestion and attachment handling
- Import utilities and metadata endpoints
- NextAuth authentication with credentials + optional email provider

## Tech Stack

- **Framework**: Next.js 14 (App Router), React 18, TypeScript
- **Data**: MongoDB + Mongoose
- **Auth**: NextAuth
- **UI**: Tailwind CSS, Radix UI primitives, custom components
- **Observability (Vercel)**: `@vercel/analytics`, `@vercel/speed-insights` in the app shell; `@vercel/functions` for Mongo connection pooling on Vercel
- **Testing**: Jest (unit/API), Playwright (E2E)
- **Email and Integrations**: Resend, optional SMTP, optional OpenAI/GCP helpers

## Architecture

### High-Level

- `src/app` contains pages and API route handlers.
- `src/models` defines Mongoose models (referrals, users, payments, tasks, etc.).
- `src/lib` contains shared auth/database/server logic.
- `src/middleware.ts` applies route protection and security headers.

### Important Directories

```text
src/
  app/
    (dashboard)/           # Dashboard pages and views
    api/                   # API routes (auth, referrals, payments, cron, etc.)
  components/              # UI components
  lib/                     # Auth, DB, server utilities
  models/                  # Mongoose models
  utils/                   # Shared client/server utilities
tests/
  unit/                    # Unit tests
  api/                     # API tests
  e2e/                     # Playwright tests
```

## Getting Started

### Quick start

1. Use **Node.js 20+** (recommended; aligns with repo tooling). Node 18+ may still work with Next.js 14.
2. Install [pnpm](https://pnpm.io) if needed: `npm install -g pnpm`
3. `cp .env.example .env.local` and set at least the [minimum local environment](#minimum-local-environment) variables.
4. `pnpm install`
5. Optional: start local MongoDB with Docker (see [Start MongoDB](#4-start-mongodb-optional-local-docker)) and set `MONGODB_URI` if you are not using the dev default.
6. `pnpm dev` → [http://localhost:3000](http://localhost:3000)
7. Create a user at [http://localhost:3000/signup](http://localhost:3000/signup)

### Minimum local environment

Set these in `.env.local` to run the app locally. See [Environment Variables](#environment-variables) for the full list and optional integrations.

| Variable | Notes |
| --- | --- |
| `NEXTAUTH_URL` | e.g. `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Required for sessions and JWT stability |
| `MONGODB_URI` | Optional in development: if omitted, the app uses `mongodb://localhost:27017/referralcrm` |

Add `ADMIN_SIGNUP_SECRET` if you need the `admin` role at signup. Email, cron, inbound webhooks, and other keys are only required when you use those features.

### 1) Prerequisites

- Node.js 20+ (recommended) or 18+
- pnpm (recommended for this repo's scripts)
- MongoDB (local, Docker, or Atlas)

### 2) Install Dependencies

```bash
pnpm install
```

### 3) Configure Environment

```bash
cp .env.example .env.local
```

Fill in values in `.env.local`. The [`.env.example`](.env.example) template uses comments for optional and alternate variables; the sections below document the same keys in more detail.

### 4) Start MongoDB (optional local Docker)

```bash
docker compose up -d
```

`docker-compose.yml` starts MongoDB with authentication:

- Username: `admin`
- Password: `password`
- Port: `27017`

If using this container, set:

```env
MONGODB_URI=mongodb://admin:password@localhost:27017/referralcrm?authSource=admin
```

### 5) Run the App

```bash
pnpm dev
```

App URL: [http://localhost:3000](http://localhost:3000)

### 6) Create First User

- Open [http://localhost:3000/signup](http://localhost:3000/signup)
- Registration is handled by `POST /api/auth/register`
- Available signup roles are `agent`, `mortgage-consultant`, and `admin`
- `admin` signup requires `ADMIN_SIGNUP_SECRET`

## Environment Variables

Source template: [`.env.example`](.env.example) (kept in sync with the sections below; optional keys may appear commented there).

### Core (required)

```env
MONGODB_URI=
NEXTAUTH_URL=
NEXTAUTH_SECRET=
```

Notes:

- If `MONGODB_URI` is omitted in development, the app falls back to `mongodb://localhost:27017/referralcrm`.
- `NEXTAUTH_SECRET` is required for auth/JWT stability.

### Auth and User Management

```env
ADMIN_SIGNUP_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

### Email (choose one provider path)

Resend:

```env
RESEND_API_KEY=
EMAIL_FROM=
```

SMTP:

```env
EMAIL_SERVER=
EMAIL_FROM=
```

### Referral Coordinator Recipients

Who gets copied on referral notifications, fee breakdowns, and intro emails. Comma or
semicolon separated.

```env
REFERRAL_NOTIFICATION_RECIPIENTS=
```

There is no built-in default. When this is unset the app logs a warning and skips the
coordinator copy entirely rather than falling back to a hardcoded address, because an address
baked into the code that later stops accepting mail is exactly how coordinator notifications
started bouncing unnoticed. Every other recipient on those messages is unaffected.

Prefer a shared alias over an individual mailbox. A personal address that fills up or gets
suspended will bounce every message it is copied on, which marks the whole message bounced
even when the primary recipient received it fine.

### Delivery Event Webhook

Delivery route: `POST /api/email-events`

Records bounces, spam complaints, delays, and deliveries against sent messages, and keeps
bouncing addresses off both To and CC lines until they recover. A message whose every To
recipient is bouncing is not sent at all; it is stored with status `suppressed` so the skip
stays visible. Each bounce lengthens the backoff window; when the window lapses the address
gets one probe send and is restored automatically if that delivers.

Configure a Resend webhook pointing at this route subscribed to `email.bounced`,
`email.complained`, `email.delivery_delayed`, and `email.delivered`, then set its signing
secret:

```env
RESEND_EVENTS_WEBHOOK_SECRET=
```

Falls back to `RESEND_WEBHOOK_SECRET` when unset. Deploy the route before creating the Resend
webhook, since the signing secret does not exist until the endpoint is created.

### Inbound Email Webhook

Inbound route: `POST /api/inbound-email`

Route validates webhook signatures and accepts any of:

```env
RESEND_INBOUND_SECRET=
RESEND_INBOUND_WEBHOOK_SECRET=
RESEND_WEBHOOK_SECRET=
```

Use `RESEND_INBOUND_SECRET` as the primary value.

Optional fallback parsing for variable inbound email formats:

```env
OPENAI_API_KEY=
```

When set, `/api/inbound-email` attempts AI field extraction only if deterministic `Label: value` parsing misses required referral fields.

### Cron and Scheduled Jobs

```env
CRON_SECRET=
TZ=America/Denver
```

`CRON_SECRET` is used by cron routes via `Authorization: Bearer <CRON_SECRET>`.

### Optional Integrations / Flags

```env
OPENAI_API_KEY=
GCP_STORAGE_CLIENT_EMAIL=
GCP_STORAGE_PRIVATE_KEY=
INBOUND_EMAIL_BUCKET=
IMPORTS_STORAGE_BUCKET=
MONGODB_ALLOW_INVALID_CERTS=false
UPLOAD_MAX_SIZE_MB=25
WEBHOOK_SECRET=
```

## Scripts and Commands

Defined in `package.json`:

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm test
pnpm test:unit
pnpm test:api
pnpm test:e2e
pnpm seed
pnpm send-auto-reminders
```

### Command Behavior Notes

- `pnpm test` runs `pnpm lint && pnpm test:unit` (not API/E2E).
- No dedicated `typecheck` script exists; run:

```bash
pnpm exec tsc --noEmit
```

- Script files like `scripts/seed.ts` load `.env` via `dotenv/config`; app runtime commonly uses `.env.local`. If a script needs env vars, either:
  - add required values to `.env`, or
  - run with exported env vars in your shell.

## Testing

### Unit Tests

```bash
pnpm test:unit
```

Uses `jest.config.ts`.

### API Tests

```bash
pnpm test:api
```

Uses `jest.api.config.ts` with `NODE_ENV=test`.

### E2E Tests

Uses Playwright (`playwright.config.ts`). On startup, the config loads **`.env.test.local`** if it exists. Copy `.env.test.example` to `.env.test.local` and fill in logins for admin, AHA agent, OOS agent, and MC.

If nothing is already listening on the base URL, Playwright starts Next.js (`next dev`). If `pnpm dev` / `npm run dev` is already running, it reuses that server.

```bash
pnpm test:e2e
```

Base URL defaults to `http://localhost:3000`, or `PLAYWRIGHT_BASE_URL` when set. Tests for a role are skipped until that role’s identifier and password are set. CI runs only when `PLAYWRIGHT_BASE_URL` plus admin login secrets are configured.

## API Overview

API routes live under `src/app/api`.

### Major Route Groups

- **Auth**: `/api/auth/[...nextauth]`, `/api/auth/register`
- **Referrals**: `/api/referrals`, `/api/referrals/[id]`, plus assignment/status/notes/actions
- **Payments**: `/api/payments`, `/api/payments/[id]/send-fee-breakdown`, `/api/payments/[id]/mark-payment-sent`
- **Dashboards**: `/api/dashboard`, `/api/dashboard/pre-approvals`, admin dashboard/report routes
- **Admin Tasks**: `/api/admin/tasks`, `/api/admin/tasks/board`, `/api/admin/tasks/[id]`
- **Agents/Lenders**: `/api/agents`, `/api/lenders`, plus nested routes
- **Imports**: `/api/imports`, `/api/imports/assist`
- **Inbound/Email**: `/api/inbound-email`, `/api/client-email`, `/api/daily-market-brief`
- **Cron**: `/api/cron/closing-reminders`, `/api/cron/auto-update-reminders`

### Response Shape

Responses are route-specific. Do not assume a single global `{ data, message }` envelope. Always check the specific route handler for response contracts.

## Deployment and Operations

### Vercel Config

`vercel.json` currently uses:

- `installCommand`: `npm install`
- `buildCommand`: `npm run build`

This differs from local pnpm-first docs. Keep this in mind when changing CI/CD commands.

### Vercel Cron Jobs

Configured schedules:

- `0 16 * * *` -> `/api/cron/closing-reminders`
- `0 15 * * *` -> `/api/cron/auto-update-reminders`
- `0 6 * * *` -> `/api/daily-market-brief`

Each scheduled route requires:

```http
Authorization: Bearer <CRON_SECRET>
```

### Production Checklist

- Set all required auth and database env vars
- Set `CRON_SECRET` for scheduled routes
- Configure email provider (`RESEND_API_KEY` + `EMAIL_FROM` or SMTP)
- Configure inbound webhook secret(s) for `/api/inbound-email`
- Ensure Mongo indexes and retention strategy are reviewed for your scale

## Troubleshooting

### Login fails or redirects unexpectedly

- Verify `NEXTAUTH_URL` and `NEXTAUTH_SECRET`.
- Ensure cookies/domains are correct for your deployment URL.

### Database connection errors

- Validate `MONGODB_URI`.
- For local Docker Mongo auth, include `authSource=admin`.
- Use `MONGODB_ALLOW_INVALID_CERTS=true` only for temporary TLS troubleshooting.

### Cron returns 401

- Confirm `CRON_SECRET` is set.
- Confirm request header is `Authorization: Bearer <CRON_SECRET>`.

### Inbound email returns 401/500

- Ensure `RESEND_API_KEY` is set.
- Ensure at least one inbound secret is set:
  `RESEND_INBOUND_SECRET` (preferred), `RESEND_INBOUND_WEBHOOK_SECRET`, or `RESEND_WEBHOOK_SECRET`.

### E2E tests fail to connect

- Confirm `.env.test.local` exists (copy from `.env.test.example`) and `PLAYWRIGHT_BASE_URL` matches the running app, default `http://localhost:3000`.
- Fill in `E2E_*_IDENTIFIER` / `E2E_*_PASSWORD` for each role you want to cover. Missing roles are skipped.
- Playwright will start Next.js if nothing is already listening on that URL.

## Contributing

1. Create a branch from your target base branch.
2. Make focused changes with clear commit messages.
3. Run checks before opening a PR:

```bash
pnpm lint
pnpm test:unit
pnpm test:api
pnpm exec tsc --noEmit
```

4. If UI or flow changes are significant, run E2E tests as well (`pnpm test:e2e` after filling `.env.test.local`).
5. Open a PR with:
   - clear summary of behavior changes
   - test plan and results
   - screenshots/video for UI changes (when applicable)

## Additional Docs

- `docs/DASHBOARD_VERIFICATION_REPORT.md`
- `docs/IMPLEMENTATION_SUMMARY.md`
- `docs/DESIGN.md`
- `docs/theme.md`

Use these as supplemental references; this README is the primary onboarding and operational guide.
