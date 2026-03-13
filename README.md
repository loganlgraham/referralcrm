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

### 1) Prerequisites

- Node.js 18+
- pnpm (recommended for this repo's scripts)
- MongoDB (local or Atlas)

Install pnpm if needed:

```bash
npm install -g pnpm
```

### 2) Install Dependencies

```bash
pnpm install
```

### 3) Configure Environment

```bash
cp .env.example .env.local
```

Then set required values in `.env.local` (see [Environment Variables](#environment-variables)).

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

Source template: `.env.example`

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

### Inbound Email Webhook

Inbound route: `POST /api/inbound-email`

Route validates webhook signatures and accepts any of:

```env
RESEND_INBOUND_SECRET=
RESEND_INBOUND_WEBHOOK_SECRET=
RESEND_WEBHOOK_SECRET=
```

Use `RESEND_INBOUND_SECRET` as the primary value.

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

```bash
pnpm test:e2e
```

Uses Playwright config from `playwright.config.ts`.

Important:

- Base URL defaults to `http://localhost:3000`.
- Playwright does not auto-start the app server in config.
- Start the app yourself before running E2E:

```bash
pnpm dev
```

In another terminal:

```bash
pnpm test:e2e
```

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

Both cron endpoints require:

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

- Verify app is running at `PLAYWRIGHT_BASE_URL` or `http://localhost:3000`.

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

4. If UI or flow changes are significant, run E2E tests as well.
5. Open a PR with:
   - clear summary of behavior changes
   - test plan and results
   - screenshots/video for UI changes (when applicable)

## Additional Docs

- `DASHBOARD_VERIFICATION_REPORT.md`
- `IMPLEMENTATION_SUMMARY.md`

Use these as supplemental references; this README is the primary onboarding and operational guide.
