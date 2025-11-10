# Referral CRM (AFC & AHA)

A production-ready referral CRM built with Next.js 14 (App Router), TypeScript, Tailwind CSS (shadcn/ui ready), MongoDB, and NextAuth. The system enables AFC mortgage consultants and AHA real estate agents to route and track out-of-state agent referrals, monitor SLAs, manage payments, and import bulk data.

## Features

- 🔐 Email & Google sign-in with role-based access control (admin, manager, mc, agent, viewer)
- 🧭 Dashboard with KPI cards, leaderboards, and SLA alert scaffolding
- 📋 Referral intake workflow with audit logging, timeline, SLA clocks, and payments view
- 📄 CSV/XLSX Import Wizard with header mapping and preview
- 💰 Payment tracking with expected vs received rollups
- 📊 Agents, lenders, and referrals tables with server-side data helpers
- 🧪 Testing scaffolding (Jest unit + API, Playwright E2E) and seed script

## Tech stack

- [Next.js 14 (App Router)](https://nextjs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) compatible utilities
- [MongoDB + Mongoose](https://mongoosejs.com/)
- [NextAuth](https://next-auth.js.org/) Email & Google providers
- [pnpm](https://pnpm.io/) for package management

## Getting started

### Prerequisites

- Node.js 18+
- pnpm `npm install -g pnpm`
- Docker (optional for local MongoDB)

### Installation

```bash
pnpm install
```

> **Note:** The package manifest is included but dependencies are not pre-installed in this environment. Run `pnpm install` locally to fetch packages.

### Environment variables

Copy `.env.example` to `.env.local` and provide values:

```bash
cp .env.example .env.local
```

Required keys:

- `MONGODB_URI` – MongoDB Atlas connection string
- `NEXTAUTH_URL` – e.g. `https://your-vercel-domain.vercel.app`
- `NEXTAUTH_SECRET` – 32+ char secret (`openssl rand -base64 32`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `EMAIL_SERVER` – SMTP connection string (e.g. `smtp://user:pass@smtp.host:587`)
- `EMAIL_FROM` – default From address
- `RESEND_API_KEY` / `RESEND_INBOUND_SECRET` – Resend transactional email and inbound webhook signing
- `GCP_STORAGE_CLIENT_EMAIL`, `GCP_STORAGE_PRIVATE_KEY`, `INBOUND_EMAIL_BUCKET` – Google Cloud Storage service account & bucket for inbound attachments
- `TZ` – defaults to `America/Denver`

### Local development

Start MongoDB locally (optional if using Atlas):

```bash
docker-compose up -d
```

Run the app:

```bash
pnpm dev
```

Visit [http://localhost:3000](http://localhost:3000).

### Seeding sample data

Populate the database with sample agents, lenders, referrals, and payments:

```bash
pnpm seed
```

### Testing

- Unit tests: `pnpm test:unit`
- API tests: `pnpm test:api`
- E2E tests: `pnpm test:e2e`

### Project structure

```
src/
  app/
    (auth)/login
    (dashboard)/...
    api/
  components/
    charts/
    forms/
    imports/
    layout/
    referrals/
    tables/
  lib/
    server/
  models/
  utils/
  types/
```

Key directories:

- `src/models` – Mongoose schemas with indexes and helper types
- `src/lib/server` – server-side helpers for data access & KPIs
- `src/app/api` – REST endpoints secured via NextAuth session checks
- `src/components` – UI primitives, tables, import wizard, referral detail widgets

## Deployment

### Vercel

1. Create a new Vercel project and import this repository.
2. Set the environment variables from `.env.local` in the Vercel dashboard.
3. Configure build command `pnpm install && pnpm build` and output directory `.next`.
4. Ensure the project uses the **Next.js** framework preset.

### MongoDB Atlas

- Create a free or dedicated cluster.
- Configure a user with read/write access and whitelist Vercel IPs.
- Recommended indexes:
  - `Referral`: `{ status: 1, createdAt: -1 }`, `{ lookingInZip: 1 }`, `{ lender: 1 }`, `{ assignedAgent: 1 }`, `{ loanFileNumber: 1 }`
  - `Payment`: `{ referralId: 1, status: 1 }`
  - `Agent`: `{ statesLicensed: 1 }`, `{ zipCoverage: 1 }`

### Timezone handling

All date computations leverage `date-fns` and default to `America/Denver`. Ensure your deployment sets `TZ=America/Denver`.

## API overview

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/referrals` | GET | List referrals or fetch KPI summaries/leaderboards via query params |
| `/api/referrals` | POST | Create referral (validated with Zod) |
| `/api/referrals/:id` | GET/PATCH/DELETE | Retrieve, update, or soft-delete a referral |
| `/api/referrals/:id/activities` | GET/POST | Timeline activities |
| `/api/referrals/:id/assign` | POST | Assign agent |
| `/api/referrals/:id/status` | POST | Update status with audit logging |
| `/api/payments` | GET/POST/PATCH | Payment management |
| `/api/agents` | GET | Active agents |
| `/api/lenders` | GET | Lender/MC list |
| `/api/imports` | POST | Start import job |

## Import wizard

1. Upload CSV/XLSX/ZIP files.
2. Auto-detected headers populate the mapping UI.
3. Preview the first 20 rows to verify data alignment.
4. Confirm mapping to trigger server-side upsert (scaffolded in `/api/imports`).
5. Original file metadata is available via logs for re-runs.

## Roadmap / next steps

- Implement SLA alert widgets with background jobs
- Add duplicate detection for borrower contact info within 30 days
- Integrate webhook endpoint for automated status updates
- Expand Playwright coverage for end-to-end flows

## License

MIT © 2024 AFC & AHA
