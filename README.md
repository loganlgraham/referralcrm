# Referral CRM (AFC & AHA)

A production-ready referral CRM built with Next.js 14 (App Router), TypeScript, Tailwind CSS (shadcn/ui ready), MongoDB, and NextAuth. The system enables AFC mortgage consultants and AHA real estate agents to route and track out-of-state agent referrals, monitor SLAs, manage payments, and import bulk data.

## Table of Contents

- [Overview](#overview)
- [Business Context](#business-context)
- [System Architecture](#system-architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Database Schema](#database-schema)
- [API Documentation](#api-documentation)
- [Feature Usage Guides](#feature-usage-guides)
- [Development Workflow](#development-workflow)
- [Deployment](#deployment)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [License](#license)

## Overview

The Referral CRM is a comprehensive system designed to manage the complete lifecycle of real estate referrals between AFC (mortgage consultants) and AHA (real estate agents). The system handles referral routing, agent assignment, SLA tracking, payment management, follow-up task automation, and comprehensive reporting across multiple dashboards.

### Key Capabilities

- **Referral Management**: Complete workflow from lead intake to deal closure with status tracking, agent assignment, and audit logging
- **Multi-Dashboard Analytics**: Four specialized dashboards (Main, MC, Agent, Admin) with real-time KPIs and performance metrics
- **SLA Monitoring**: Automated tracking of service level agreements with business hours calculations and alert scaffolding
- **Payment Tracking**: Comprehensive revenue management with expected vs received tracking, commission calculations, and referral fee management
- **Task Automation**: Automated follow-up task generation based on referral status with manual task support and reminder system
- **Data Import**: AI-powered bulk data import with intelligent header mapping and data standardization
- **Mortgage Tools**: Built-in mortgage calculator, affordability calculator, and market insights

## Business Context

### Organizations

- **AFC (American Financial Consultants)**: Mortgage consultants who originate loans and refer clients to real estate agents
- **AHA (American Home Agents)**: Real estate agents who work with AFC-referred clients, including both in-network (AHA) and out-of-state (AHA_OOS) agents

### Referral Workflow

1. **Lead Intake**: Mortgage consultant or admin creates a referral with borrower information, property location, and timeline
2. **Agent Assignment**: System suggests agents based on zip code coverage, state licensing, and availability
3. **Status Progression**: Referral moves through statuses: New Lead → Paired → In Communication → Active Lead → Under Contract → Closed
4. **SLA Tracking**: System monitors time to assignment, first contact, contract, and close against defined thresholds
5. **Payment Management**: Tracks expected revenue, commission splits, referral fees, and payment status
6. **Follow-up Tasks**: Automated task generation ensures consistent communication and operational tasks are completed

### Network Classifications

- **AHA**: In-network agents with full support and tracking
- **AHA_OOS**: Out-of-state agents who handle referrals outside primary markets
- **AGIT**: Special designation for certain agent types
- **OUTSIDE_AGENT**: Deals closed by agents not in the system (excluded from revenue calculations)

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client (Browser)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Dashboard  │  │  Referrals   │  │   Agents     │      │
│  │   Components │  │  Components  │  │  Components  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ HTTP/HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Next.js 14 App Router (Server)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   API Routes │  │  Middleware   │  │   Auth       │     │
│  │   (REST)     │  │  (RBAC)       │  │  (NextAuth)  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Server     │  │   Utils      │  │   Models     │     │
│  │   Helpers    │  │   (SLA, etc) │  │   (Mongoose)  │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ Mongoose ODM
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    MongoDB Atlas                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Referrals  │  │   Payments    │  │   Agents      │     │
│  │   Users      │  │   Activities │  │   Lenders    │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ External APIs
                           ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   Resend     │  │   OpenAI     │  │   Google      │
│   (Email)    │  │   (AI)       │  │   Cloud      │
│              │  │              │  │   Storage    │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Data Flow

```
User Action (Frontend)
    ↓
API Route Handler
    ↓
Authentication Check (NextAuth Session)
    ↓
Authorization Check (RBAC)
    ↓
Business Logic (Server Helpers)
    ↓
Database Operation (Mongoose Models)
    ↓
Response (JSON)
    ↓
Client Update (SWR/React State)
```

### Component Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # Authentication routes
│   ├── (dashboard)/       # Dashboard pages
│   └── api/               # API route handlers
├── components/            # React components
│   ├── agents/           # Agent management UI
│   ├── charts/           # Dashboard charts & KPIs
│   ├── dashboard/        # Dashboard components
│   ├── forms/            # Form components
│   ├── imports/          # Import wizard UI
│   ├── lenders/          # Lender/MC management
│   ├── mortgage/         # Mortgage calculator tools
│   ├── referrals/        # Referral detail views
│   ├── tables/           # Data tables
│   └── layout/           # Layout components
├── lib/                   # Shared libraries
│   ├── server/           # Server-side helpers
│   └── auth-config.ts    # NextAuth configuration
├── models/                # Mongoose schemas
├── utils/                 # Utility functions
└── types/                 # TypeScript types
```

## Features

### Authentication & Authorization

#### Authentication Providers

- **Email/Password**: Standard credentials-based authentication with bcrypt password hashing
- **Email Magic Link**: Passwordless authentication via email link (Resend or SMTP)
- **Google OAuth**: Single sign-on via Google (optional)

#### Role-Based Access Control (RBAC)

The system supports five distinct roles with hierarchical permissions:

| Role | Description | Permissions |
|------|-------------|-------------|
| **admin** | Full system access | All operations, user management, system configuration |
| **manager** | Operational oversight | View all referrals, manage assignments, access reports |
| **mc** (Mortgage Consultant) | Lender/MC access | View/manage own referrals, create referrals, view assigned agents |
| **agent** | Real estate agent | View/manage assigned referrals, update status, add notes |
| **viewer** | Read-only access | View referrals and dashboards, no modifications |

#### Access Control Rules

- **Referral Viewing**: Agents and MCs can only view referrals they're assigned to; admins/managers/viewers can view all
- **Referral Management**: Only admins, managers, and assigned agents/MCs can modify referrals
- **Dashboard Access**: All roles can access dashboards, but metrics are filtered by role
- **API Security**: All API routes check session and role before processing requests

### Dashboard System

The application provides four specialized dashboards, each optimized for different user roles and use cases.

#### Main Dashboard

**Purpose**: Overall business performance and health metrics

**Key Metrics**:
- **Total Referrals**: Count of referrals created in selected timeframe
- **Deals Closed**: Number of closed deals (excludes outside agent deals)
- **Close Rate**: Percentage of referrals that closed (calculated from referrals created in timeframe)
- **Realized Revenue**: Total revenue from paid deals
- **Expected Revenue**: Outstanding revenue from active deals
- **Lost Revenue**: Revenue from lost/terminated deals
- **Pipeline Value**: Sum of expected revenue from active deals
- **Avg Days Closed to Paid**: Average time from deal close to payment
- **Avg Days to Contract**: Average time from referral creation to under contract
- **Attach Rates**: AFC, AHA, and AHA_OOS attach rates (percentage of deals using each service)

**Filters**:
- Timeframe: Day, Week, Month, Year, YTD, All Time, Custom
- Network: ALL, AHA, AHA_OOS

#### MC Dashboard

**Purpose**: Mortgage consultant performance tracking and leaderboards

**Key Metrics**:
- **Request Trend**: Referral creation trend over time (grouped by date)
- **Revenue Leaderboard**: Top MCs by total revenue (excludes outside agent deals)
- **Close Rate Leaderboard**: Top MCs by close rate percentage
- **Request Leaderboard**: Top MCs by referral count

**Filters**: Same timeframe and network filters as Main Dashboard

#### Agent Dashboard

**Purpose**: Real estate agent performance and earnings tracking

**Key Metrics**:
- **Referral Leaderboard**: Top agents by referral count
- **Close Rate Leaderboard**: Top agents by close rate
- **Revenue Paid**: Total realized revenue per agent
- **Revenue Expected**: Outstanding expected revenue per agent
- **Average Commission %**: Average commission basis points
- **Average Referral Fee %**: Average referral fee basis points
- **Net Revenue**: Commission minus referral fees
- **Lost Deals**: Count of deals attributed to outside agents
- **Average Closed Deal Size**: Average contract value of closed deals

**Filters**: Same timeframe and network filters as Main Dashboard

#### Admin Dashboard

**Purpose**: SLA tracking and operational metrics

**Key Metrics**:
- **Time to First Contact**: Average hours from referral creation to first agent contact
- **First Contact <24h Rate**: Percentage of referrals with first contact within 24 hours
- **Time to Assignment**: Average hours from referral creation to agent assignment
- **Assignment Rate**: Percentage of referrals with assigned agents
- **Days to Contract**: Average days from referral creation to under contract
- **Days to Close**: Average days from under contract to closed
- **Unassigned Referrals**: Count of referrals without assigned agents

**SLA Thresholds**:
- Assignment: 2 hours (120 minutes)
- First Contact: 24 hours
- Under Contract: 14 days
- Close: 45 days
- Payment After Close: 10 days

### Referral Management

#### Referral Status Workflow

Referrals progress through the following statuses:

1. **New Lead**: Initial referral created, awaiting agent assignment
2. **Paired**: Agent assigned, initial connection pending
3. **In Communication**: Agent has made first contact with borrower
4. **Active Lead**: Borrower is actively searching/viewing properties
5. **Under Contract**: Purchase agreement signed, deal in progress
6. **Closed**: Deal successfully closed
7. **Lost**: Referral lost (no deal)
8. **Terminated**: Deal terminated (inspection, appraisal, financing issues)

#### Referral Creation

Referrals can be created by:
- **Mortgage Consultants**: For their clients
- **Admins/Managers**: For any source
- **Agents**: Self-referrals (with special handling)

**Required Fields**:
- Borrower name, email, phone
- Property location (zip code or city/state)
- Client type (Buyer, Seller, Both)
- Loan file number (for MC-originated referrals)

**Optional Fields**:
- Timeline (ASAP, 1-3 months, 3-6 months, 6-12 months, 12+ months)
- Pre-approval amount
- Estimated purchase price
- Initial notes
- Source and endorser

#### Agent Assignment

**Automatic Suggestions**:
- System suggests agents based on:
  - Zip code coverage
  - State licensing
  - Agent availability (active status)
  - Historical performance (optional)

**Manual Assignment**:
- Admins/managers can manually assign any agent
- Agents can be assigned to buy-side, sell-side, or both
- Assignment triggers SLA tracking start

**Coverage Suggestions**:
- OpenAI-powered agent suggestions based on property location
- Considers agent specialties, languages, and market experience

#### Timeline & Activity Logging

**Activity Types**:
- Status changes (with audit trail)
- Notes added/edited/deleted
- Agent assignments
- Lender assignments
- Contact actions (call, email, text)
- Deal creation/updates
- Payment updates

**Timeline Display**:
- Chronological activity feed
- Color-coded by activity type
- Filterable by activity category
- Shows user, timestamp, and details

#### Audit Trail

All significant changes are logged with:
- Field name
- Old value
- New value
- User who made the change
- Timestamp
- IP address (optional)

**Audited Fields**:
- Status changes
- Agent assignments
- Lender assignments
- Financial fields (commission, referral fee)
- Deal status changes

#### Notes System

**Note Types**:
- **Regular Notes**: Visible to all users with access
- **Hidden Notes**: Admin-only notes (hidden from agents/MCs)
- **Agent Notes**: Notes on agent profiles (can be hidden from agent)
- **Lender Notes**: Notes on lender profiles (can be hidden from MC)

**Note Features**:
- Rich text support
- Edit and delete capabilities
- Author tracking
- Timestamp display

#### Deal Management

**Deal Creation**:
- Deals are created when referral moves to "Under Contract"
- Can have multiple deals per referral (buy-side, sell-side)
- Each deal tracks:
  - Contract price
  - Commission basis points
  - Referral fee basis points
  - Closing date
  - Payment status

**Deal Status Progression**:
- `under_contract` → `past_inspection` → `past_appraisal` → `clear_to_close` → `closed` → `payment_sent` → `paid`
- Or `terminated` at any stage

**Deal Attribution**:
- Tracks which agent closed the deal (AHA, AHA_OOS, or OUTSIDE_AGENT)
- Tracks whether AFC mortgage services were used
- Tracks whether assigned agent was used

### SLA Tracking

#### Business Hours vs Calendar Time

The system uses different time calculations for different SLA stages:

**Business Hours** (8 AM - 5 PM MST, excluding weekends/holidays):
- New Lead → Paired
- Paired → In Communication

**Calendar Time** (24/7):
- In Communication → Under Contract
- Under Contract → Closed
- Closed → Paid

#### SLA Thresholds

```typescript
{
  minutesToAssignment: 120,           // 2 hours
  hoursToFirstConversation: 24,       // 24 hours
  daysToUnderContract: 14,            // 14 days
  daysToClose: 45,                    // 45 days
  daysWithoutTouchPoint: 3,           // 3 days
  daysToPaymentAfterClose: 10,        // 10 days
  adminHoursToCommunication: 24,     // 24 hours
  activeLeadCheckInDays: 7            // 7 days
}
```

#### SLA Storage Points

| Event | SLA Fields Updated |
|-------|-------------------|
| Agent Assigned | `timeToAssignmentHours` |
| Status → "In Communication" | `timeToFirstAgentContactHours` |
| Status → "Paired" | `lastPairedAt` |
| Status → "Under Contract" | `lastUnderContractAt`, `daysToContract` |
| Status → "Closed" | `lastClosedAt`, `daysToClose` |
| Status → "Paid" | `lastPaidAt` |

#### SLA Insights & Recommendations

The system provides:
- **Duration Calculations**: Time spent in each stage
- **Risk Assessment**: On track, watch, or at risk status
- **Recommendations**: Actionable tasks to improve SLA compliance
- **Historical Comparison**: Previous deal performance metrics

### Payment Tracking

#### Payment Status Flow

```
under_contract → past_inspection → past_appraisal → 
clear_to_close → closed → payment_sent → paid
```

Or: `terminated` at any stage

#### Revenue Calculations

**Realized Revenue**:
- Sum of `receivedAmountCents` from payments with status `paid`
- Excludes deals with `agentAttribution === 'OUTSIDE_AGENT'`

**Expected Revenue**:
- Sum of `expectedAmountCents` from active deals (not closed/paid/terminated)
- Calculated as: `contractPriceCents × (commissionBasisPoints / 10000)`

**Lost Revenue**:
- Revenue from terminated or lost deals
- Tracks opportunity cost

**Pipeline Value**:
- Sum of expected revenue from all active deals
- Provides visibility into future revenue

#### Commission & Fee Calculations

**Commission Structure**:
- Default agent commission: 300 basis points (3%)
- Default referral fee: 2500 basis points (25%)
- Customizable per referral/deal

**Net Revenue**:
- Agent commission minus referral fee
- Formula: `(contractPrice × commissionBPS / 10000) - (contractPrice × referralFeeBPS / 10000)`

**Payment Tracking**:
- Expected amount vs received amount
- Payment date tracking
- Invoice date tracking
- Fee breakdown email automation

#### Payment Management Features

- **Fee Breakdown Emails**: Automated emails sent 7 days before closing with commission and fee details
- **Payment Status Updates**: Track when payments are sent and received
- **Payment History**: Complete audit trail of payment status changes
- **Revenue Reports**: Export revenue data by timeframe, network, agent, or MC

### Follow-up Tasks System

#### Task Types

**Static Tasks**: Pre-defined tasks that automatically generate based on referral status

**Manual Tasks**: User-created tasks for specific referrals

**Agent Tasks**: Tasks assigned to specific agents

#### Static Task Definitions

Tasks are defined per referral status in `src/constants/static-follow-up-tasks.ts`:

**New Lead Tasks**:
- Assign Agent and MC - Change Status to Paired
- Add Real Estate Agent in Homebot (AHA only)
- Customer Care: Initial Introduction (AHA only, 3 days)
- Customer Care: Follow-up Check In (AHA only, 14 days)

**Paired Tasks**:
- Attach agent to client in Homebot
- Check in - Agent connected with Buyer? (1 day)

**In Communication Tasks**:
- Check-ins at Week 1, Week 2, Week 4, Week 8 (for ASAP/1-3mo/3-6mo timelines)
- Monthly check-ins for 6-12mo/12+mo timelines
- Customer Care tasks (AHA only)

**Under Contract Tasks**:
- Update Realtor Audit Spreadsheet
- UC Congratulations - Agent Call
- Save Contract in Gdrive folder
- Check in UC - Midway (14 days)
- Send W-9 and Check Instructions (23 days, auto-email)
- Call and Confirm Closing is still on (29 days)
- Change Deal to Closed (31 days)

**Closed Tasks**:
- Update 49 Agents map - yellow
- Buyer Concierge Feedback email
- Post Closing card - Agent/Buyer

#### Task Categories

- **ops**: Operational tasks (Homebot, spreadsheets, status updates)
- **communication**: Customer/agent communication tasks
- **pipeline**: Deal progression tasks
- **finance**: Payment and financial tasks

#### Task Priorities

- **urgent**: Requires immediate attention
- **high**: Important, should be completed soon
- **medium**: Standard priority
- **low**: Nice to have

#### Task Completion Tracking

- Tasks are stored in referral's `followUpTaskState` field
- Completion status tracked per task ID
- Tasks can be toggled complete/incomplete
- Completion history maintained

#### Reminder System

**Reminder Types**:
- **Daily**: Tasks due today or overdue
- **Weekly**: All pending tasks for the week

**Reminder Delivery**:
- Email reminders (if user has reminders enabled)
- In-app notification bell
- Task board display

**Reminder Configuration**:
- Users can enable/disable reminders in profile settings
- Choose frequency: daily or weekly
- Reminders sent via Resend or SMTP

#### Automated Task Generation

Tasks are automatically generated when:
- Referral status changes
- Referral is created
- Timeline is updated
- Deal moves to new stage

Tasks are filtered by:
- Referral status
- Timeline (for communication tasks)
- AHA designation (for AHA-specific tasks)
- Task completion status

### Import Wizard

#### Supported File Formats

- **CSV**: Comma-separated values
- **XLSX**: Excel spreadsheets
- **ZIP**: Archives containing multiple CSV/XLSX files

#### Import Process

1. **File Upload**: User uploads file(s) via drag-and-drop or file picker
2. **Header Detection**: System auto-detects column headers
3. **AI-Powered Mapping**: OpenAI suggests field mappings for:
   - Referrals (borrower info, property location, timeline, etc.)
   - Agents (name, email, phone, coverage, etc.)
   - Lenders/MCs (name, email, NMLS ID, states, etc.)
   - Deal payouts (contract price, commission, fees, etc.)
4. **Data Preview**: First 20 rows displayed for verification
5. **Data Cleanup**: AI standardizes data formats (phone numbers, addresses, etc.)
6. **Mapping Confirmation**: User reviews and confirms field mappings
7. **Import Execution**: Server-side upsert operation
8. **Results**: Success/failure report with row-level errors

#### Import Features

- **Duplicate Detection**: Identifies potential duplicates based on email/phone
- **Data Validation**: Zod schema validation before import
- **Error Handling**: Row-level error reporting
- **Batch Processing**: Handles large files efficiently
- **Metadata Tracking**: Original file info stored for re-runs

### Additional Features

#### Mortgage Calculator

Comprehensive mortgage calculation tools:

- **Basic Calculator**: Principal, interest, taxes, insurance (PITI)
- **Amortization Table**: Month-by-month payment breakdown
- **Extra Principal Impact**: Calculate savings from additional payments
- **Scenario Comparison**: Compare multiple loan scenarios
- **Affordability Calculator**: Determine max purchase price based on income
- **Loan Types**: Conventional, FHA, VA, USDA support
- **PMI/MIP Calculations**: Accurate PMI for conventional, MIP for FHA

#### NPS Survey System

- **Token-Based Surveys**: Secure survey links for agents and lenders
- **Score Tracking**: NPS scores stored on agent/lender profiles
- **Email Integration**: Survey links included in closing emails
- **Expiration Handling**: Survey links expire after set period
- **One-Time Submission**: Prevents duplicate submissions

#### Inbound Email Processing

- **Email Parsing**: Extracts referral information from emails
- **Attachment Handling**: Stores attachments in Google Cloud Storage
- **Signature Detection**: Identifies and extracts email signatures
- **Auto-Creation**: Can automatically create referrals from emails
- **Webhook Support**: Resend inbound webhook integration

#### Agent Onboarding

- **Onboarding Tasks**: Pre-defined task checklist for new agents
- **Welcome Emails**: Automated welcome email system
- **Profile Completion**: Tracks required fields completion
- **Coverage Setup**: Guides agent through coverage area setup

#### Notification System

- **In-App Notifications**: Real-time notification bell
- **Email Notifications**: Configurable email notifications
- **Notification Types**: Assignment, status change, task reminders, payment updates
- **Read/Unread Tracking**: Notification status management

## Tech Stack

### Core Technologies

- **[Next.js 14](https://nextjs.org/)**: React framework with App Router for server-side rendering and API routes
- **[TypeScript](https://www.typescriptlang.org/)**: Type-safe JavaScript for better developer experience
- **[React 18](https://react.dev/)**: UI library with hooks and server components
- **[MongoDB](https://www.mongodb.com/)**: NoSQL database for flexible data storage
- **[Mongoose](https://mongoosejs.com/)**: MongoDB object modeling for Node.js

### Styling & UI

- **[Tailwind CSS](https://tailwindcss.com/)**: Utility-first CSS framework
- **[shadcn/ui](https://ui.shadcn.com/)**: Re-usable component library (compatible)
- **[Lucide React](https://lucide.dev/)**: Icon library
- **[Radix UI](https://www.radix-ui.com/)**: Accessible component primitives

### Authentication & Security

- **[NextAuth.js](https://next-auth.js.org/)**: Authentication framework
- **[bcryptjs](https://www.npmjs.com/package/bcryptjs)**: Password hashing
- **[MongoDB Adapter](https://github.com/nextauthjs/adapters)**: NextAuth MongoDB integration

### Data Management

- **[Zod](https://zod.dev/)**: Schema validation
- **[SWR](https://swr.vercel.app/)**: Data fetching and caching
- **[TanStack Table](https://tanstack.com/table)**: Powerful table/data grid

### Utilities

- **[date-fns](https://date-fns.org/)**: Date manipulation and formatting
- **[date-fns-tz](https://github.com/marnusw/date-fns-tz)**: Timezone support
- **[PapaParse](https://www.papaparse.com/)**: CSV parsing
- **[JSZip](https://stuk.github.io/jszip/)**: ZIP file handling
- **[Axios](https://axios-http.com/)**: HTTP client

### External Services

- **[Resend](https://resend.com/)**: Transactional email service
- **[OpenAI API](https://openai.com/api/)**: AI-powered features (import mapping, coverage suggestions)
- **[Google Cloud Storage](https://cloud.google.com/storage)**: File storage for email attachments
- **[Vercel](https://vercel.com/)**: Hosting and deployment platform

### Testing

- **[Jest](https://jestjs.io/)**: Unit and API testing
- **[Playwright](https://playwright.dev/)**: End-to-end testing
- **[Testing Library](https://testing-library.com/)**: React component testing
- **[Supertest](https://github.com/visionmedia/supertest)**: API endpoint testing

## Getting Started

### Prerequisites

- **Node.js**: Version 18 or higher
- **pnpm**: Package manager (`npm install -g pnpm`)
- **Docker**: Optional, for local MongoDB development
- **MongoDB Atlas Account**: For production or cloud development

### Installation

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd referralcrm
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env.local
   ```

4. **Configure `.env.local`** with required values (see [Environment Variables](#environment-variables))

5. **Start local MongoDB** (optional):
   ```bash
   docker-compose up -d
   ```

6. **Run the development server**:
   ```bash
   pnpm dev
   ```

7. **Visit** [http://localhost:3000](http://localhost:3000)

### Environment Variables

#### Required Variables

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/referralcrm
# Or for Atlas: mongodb+srv://user:pass@cluster.mongodb.net/dbname

# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-32-character-secret-here
# Generate with: openssl rand -base64 32

# Google OAuth (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Email Configuration (choose one)
# Option 1: Resend (recommended)
RESEND_API_KEY=re_xxxxxxxxxxxxx
RESEND_INBOUND_SECRET=your-inbound-secret
EMAIL_FROM=noreply@yourdomain.com

# Option 2: SMTP
EMAIL_SERVER=smtp://user:pass@smtp.host:587
EMAIL_FROM=noreply@yourdomain.com

# AI Features
OPENAI_API_KEY=sk-xxxxxxxxxxxxx

# Google Cloud Storage (for email attachments)
GCP_STORAGE_CLIENT_EMAIL=service-account@project.iam.gserviceaccount.com
GCP_STORAGE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
INBOUND_EMAIL_BUCKET=your-bucket-name

# Timezone
TZ=America/Denver

# Task Reminders (for cron jobs)
TASK_REMINDER_SECRET=your-secret-for-cron-authentication
```

#### Optional Variables

```bash
# Analytics (optional)
NEXT_PUBLIC_VERCEL_ANALYTICS_ID=your-analytics-id

# Development
NODE_ENV=development
```

### Seeding Sample Data

Populate the database with sample data for development:

```bash
pnpm seed
```

This creates:
- Sample agents (with coverage areas)
- Sample lenders/MCs
- Sample referrals (various statuses)
- Sample payments/deals
- Sample users (for testing)

### First User Creation

1. **Via Registration** (if enabled):
   - Visit `/auth/register`
   - Fill out registration form
   - Admin must assign role after registration

2. **Via Database** (direct):
   ```javascript
   // In MongoDB shell or script
   db.users.insertOne({
     email: "admin@example.com",
     username: "admin",
     passwordHash: "$2a$10$...", // bcrypt hash
     role: "admin",
     name: "Admin User"
   })
   ```

3. **Via Seed Script**:
   - Modify `scripts/seed.ts` to include admin user
   - Run `pnpm seed`

## Database Schema

### Core Models

#### User

```typescript
{
  _id: ObjectId,
  email: string (unique, indexed),
  username: string (unique),
  name: string,
  passwordHash: string (hashed with bcrypt),
  role: 'agent' | 'mortgage-consultant' | 'admin' | null,
  emailVerified: Date,
  image: string (URL),
  reminderEnabled: boolean,
  reminderFrequency: 'daily' | 'weekly',
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `email`: unique
- `username`: unique

#### Agent

```typescript
{
  _id: ObjectId,
  userId: ObjectId (ref: User, sparse unique),
  name: string (required),
  email: string (unique, indexed),
  phone: string,
  licenseNumber: string,
  statesLicensed: [string] (indexed),
  zipCoverage: [string] (indexed),
  coverageLocations: [{
    label: string,
    zipCodes: [string]
  }],
  active: boolean (default: true),
  closings12mo: number,
  closingRatePercentage: number,
  npsScore: number,
  avgResponseHours: number,
  brokerage: string,
  officeAddress: {
    street: string,
    city: string,
    state: string,
    zipCode: string
  },
  markets: [string],
  specialties: [string],
  languages: [string],
  ahaDesignation: 'AHA' | 'AHA_OOS' | 'AGIT' | null,
  experienceSince: Date,
  notes: [{
    author: ObjectId (ref: User),
    authorName: string,
    authorRole: string,
    content: string,
    hiddenFromAgent: boolean,
    createdAt: Date
  }],
  source: string,
  welcomeEmailSentAt: Date,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `userId`: sparse unique
- `email`: unique
- `statesLicensed`: array index
- `zipCoverage`: array index

#### LenderMC

```typescript
{
  _id: ObjectId,
  userId: ObjectId (ref: User, sparse unique),
  name: string (required),
  email: string (unique, indexed),
  phone: string,
  nmlsId: string,
  licensedStates: [string] (indexed),
  team: string,
  region: string,
  npsScore: number,
  notes: [{
    author: ObjectId (ref: User),
    authorName: string,
    authorRole: string,
    content: string,
    hiddenFromMc: boolean,
    createdAt: Date
  }],
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `userId`: sparse unique
- `email`: unique
- `licensedStates`: array index

#### Referral

```typescript
{
  _id: ObjectId,
  source: string,
  endorser: string,
  clientType: 'Seller' | 'Buyer' | 'Both' (required),
  borrower: {
    firstName: string,
    lastName: string,
    name: string (required),
    email: string (required, indexed),
    phone: string (required)
  },
  lookingInZip: string (indexed, required for new),
  lookingInZips: [string],
  borrowerCurrentAddress: string,
  propertyAddress: string,
  propertyCity: string,
  propertyState: string,
  propertyPostalCode: string,
  dealSide: 'buy' | 'sell' (default: 'buy'),
  stageOnTransfer: string,
  initialNotes: string,
  loanFileNumber: string (indexed, unique, required for MC-originated),
  assignedAgent: ObjectId (ref: Agent, indexed),
  buySideAgent: ObjectId (ref: Agent, indexed),
  sellSideAgent: ObjectId (ref: Agent, indexed),
  status: ReferralStatus (indexed, default: 'New Lead'),
  statusLastUpdated: Date,
  loanType: string,
  preApprovalAmountCents: number,
  estPurchasePriceCents: number,
  commissionBasisPoints: number (default: 300),
  referralFeeBasisPoints: number (default: 2500),
  closedPriceCents: number,
  referralFeeDueCents: number,
  notes: [{
    author: ObjectId (ref: User),
    authorName: string,
    authorRole: string,
    content: string,
    createdAt: Date,
    updatedAt: Date
  }],
  attachments: [{
    filename: string,
    url: string,
    uploadedAt: Date
  }],
  inboundEmail: {
    messageId: string (unique, partial index),
    from: string,
    subject: string,
    body: string,
    receivedAt: Date
  },
  manualTasks: [{
    id: string,
    title: string,
    message: string,
    dueAt: string,
    priority: 'urgent' | 'high' | 'medium' | 'low',
    category: 'assignment' | 'communication' | 'pipeline' | 'finance' | 'ops',
    createdAt: string
  }],
  audit: [{
    field: string,
    oldValue: string,
    newValue: string,
    user: string,
    timestamp: Date
  }],
  lostAssignments: [{
    agent: ObjectId (ref: Agent),
    lostAt: Date,
    reason: string
  }],
  lender: ObjectId (ref: LenderMC),
  buyer: ObjectId (ref: Buyer),
  sla: {
    timeToFirstAgentContactHours: number,
    timeToAssignmentHours: number,
    daysToContract: number,
    daysToClose: number,
    contractToCloseMinutes: number,
    closedToPaidMinutes: number,
    previousContractToCloseMinutes: number,
    previousClosedToPaidMinutes: number,
    lastPairedAt: Date,
    lastUnderContractAt: Date,
    lastClosedAt: Date,
    lastPaidAt: Date
  },
  org: 'AFC' | 'AHA' (default: 'AFC'),
  ahaBucket: 'AHA' | 'AHA_OOS' | null,
  origin: 'agent' | 'mc' | 'admin',
  timeline: 'asap' | '1-3_months' | '3-6_months' | '6-12_months' | '12+_months' | 'not_specified',
  followUpTaskState: string (JSON),
  deletedAt: Date (soft delete),
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `borrower.email` + `createdAt`: compound unique
- `loanFileNumber`: unique
- `inboundEmail.messageId`: unique (partial, where exists)
- Text index on: `borrower.name`, `borrower.email`, `borrower.phone`, `loanFileNumber`
- `status` + `createdAt`: compound
- `lookingInZip`: single
- `lender`: single
- `assignedAgent`: single
- `deletedAt` + various fields: compound for search

#### Payment

```typescript
{
  _id: ObjectId,
  referralId: ObjectId (ref: Referral, indexed, required),
  status: 'under_contract' | 'past_inspection' | 'past_appraisal' | 
           'clear_to_close' | 'closed' | 'payment_sent' | 'paid' | 'terminated',
  expectedAmountCents: number (required),
  receivedAmountCents: number (default: 0),
  contractPriceCents: number,
  terminatedReason: 'inspection' | 'appraisal' | 'financing' | 'changed_mind',
  closingDate: Date,
  propertyCity: string,
  propertyState: string,
  commissionBasisPoints: number,
  referralFeeBasisPoints: number,
  side: 'buy' | 'sell' (default: 'buy'),
  netReferralFeePaidCents: number,
  propertyAddress: string,
  agentAttribution: 'AHA' | 'AHA_OOS' | 'OUTSIDE_AGENT',
  agentId: ObjectId (ref: Agent),
  usedAfc: boolean (default: true),
  usedAssignedAgent: boolean (default: true),
  invoiceDate: Date,
  paidDate: Date,
  notes: string,
  feeBreakdownEmailSentAt: Date,
  feeBreakdownEmailSentBy: string,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes**:
- `referralId`: single
- `status`: single
- `referralId` + `status`: compound

#### Activity

```typescript
{
  _id: ObjectId,
  referralId: ObjectId (ref: Referral, indexed, required),
  type: 'status_change' | 'note' | 'assignment' | 'contact' | 'deal' | 'payment',
  description: string,
  user: {
    id: string,
    name: string,
    role: string
  },
  metadata: object,
  createdAt: Date
}
```

**Indexes**:
- `referralId`: single
- `referralId` + `createdAt`: compound

### Recommended MongoDB Indexes

For optimal performance, ensure these indexes exist:

```javascript
// Referrals
db.referrals.createIndex({ status: 1, createdAt: -1 });
db.referrals.createIndex({ lookingInZip: 1 });
db.referrals.createIndex({ lender: 1 });
db.referrals.createIndex({ assignedAgent: 1 });
db.referrals.createIndex({ loanFileNumber: 1 }, { unique: true });
db.referrals.createIndex({ 'borrower.email': 1, createdAt: 1 }, { unique: true });
db.referrals.createIndex({ deletedAt: 1, status: 1, createdAt: -1 });

// Payments
db.payments.createIndex({ referralId: 1, status: 1 });
db.payments.createIndex({ status: 1 });

// Agents
db.agents.createIndex({ statesLicensed: 1 });
db.agents.createIndex({ zipCoverage: 1 });
db.agents.createIndex({ email: 1 }, { unique: true });

// Activities
db.activities.createIndex({ referralId: 1, createdAt: -1 });
```

## API Documentation

### Authentication

All API routes (except public endpoints) require authentication via NextAuth session cookie.

### Base URL

- **Development**: `http://localhost:3000/api`
- **Production**: `https://your-domain.vercel.app/api`

### Response Format

**Success Response**:
```json
{
  "data": { ... },
  "message": "Optional success message"
}
```

**Error Response**:
```json
{
  "error": "Error message",
  "details": "Optional error details"
}
```

### Referrals API

#### `GET /api/referrals`

List referrals with filtering, sorting, and pagination.

**Query Parameters**:
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 50)
- `status`: Filter by status
- `search`: Text search (name, email, loan file number)
- `assignedAgent`: Filter by assigned agent ID
- `lender`: Filter by lender ID
- `network`: Filter by network ('ALL', 'AHA', 'AHA_OOS')
- `timeframe`: Filter by timeframe ('day', 'week', 'month', 'year', 'ytd', 'all')
- `startDate`: Custom start date (ISO string)
- `endDate`: Custom end date (ISO string)
- `sortBy`: Sort field (default: 'createdAt')
- `sortOrder`: 'asc' or 'desc' (default: 'desc')
- `kpi`: If 'true', returns KPI summary instead of referrals
- `leaderboard`: If 'mc' or 'agent', returns leaderboard data

**Response**:
```json
{
  "referrals": [...],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 100,
    "pages": 2
  }
}
```

#### `POST /api/referrals`

Create a new referral.

**Request Body**:
```json
{
  "borrower": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "555-1234"
  },
  "clientType": "Buyer",
  "lookingInZip": "80202",
  "loanFileNumber": "LN123456",
  "lender": "lender-id",
  "timeline": "asap",
  "initialNotes": "Looking for 3BR home"
}
```

**Response**: Created referral object

#### `GET /api/referrals/[id]`

Get a single referral by ID.

**Response**: Referral object with populated agent and lender

#### `PATCH /api/referrals/[id]`

Update a referral.

**Request Body**: Partial referral object with fields to update

**Response**: Updated referral object

#### `DELETE /api/referrals/[id]`

Soft delete a referral (sets `deletedAt`).

**Response**: Success message

#### `POST /api/referrals/[id]/status`

Update referral status with audit logging.

**Request Body**:
```json
{
  "status": "Paired",
  "notes": "Optional status change notes"
}
```

**Response**: Updated referral with new status

#### `POST /api/referrals/[id]/assign`

Assign an agent to a referral.

**Request Body**:
```json
{
  "agentId": "agent-id",
  "side": "buy" // or "sell" or "both"
}
```

**Response**: Updated referral

#### `POST /api/referrals/[id]/assign-lender`

Assign a lender/MC to a referral.

**Request Body**:
```json
{
  "lenderId": "lender-id"
}
```

**Response**: Updated referral

#### `GET /api/referrals/[id]/activities`

Get timeline activities for a referral.

**Response**: Array of activity objects

#### `POST /api/referrals/[id]/activities`

Create a new activity/timeline entry.

**Request Body**:
```json
{
  "type": "note",
  "description": "Activity description",
  "metadata": {}
}
```

**Response**: Created activity

#### `GET /api/referrals/[id]/notes`

Get all notes for a referral.

**Response**: Array of note objects

#### `POST /api/referrals/[id]/notes`

Create a new note.

**Request Body**:
```json
{
  "content": "Note content"
}
```

**Response**: Created note

#### `PATCH /api/referrals/[id]/notes/[noteId]`

Update a note.

**Request Body**:
```json
{
  "content": "Updated note content"
}
```

**Response**: Updated note

#### `DELETE /api/referrals/[id]/notes/[noteId]`

Delete a note.

**Response**: Success message

#### `POST /api/referrals/[id]/suggest-agent`

Get AI-powered agent suggestions.

**Request Body**:
```json
{
  "zipCode": "80202",
  "state": "CO"
}
```

**Response**: Array of suggested agents with reasons

#### `POST /api/referrals/[id]/pre-approval`

Update pre-approval information.

**Request Body**:
```json
{
  "amountCents": 50000000,
  "loanType": "conventional"
}
```

**Response**: Updated referral

#### `POST /api/referrals/[id]/contact-action`

Log a contact action (call, email, text).

**Request Body**:
```json
{
  "type": "call",
  "notes": "Spoke with borrower about preferences"
}
```

**Response**: Created activity

#### `POST /api/referrals/[id]/send-emails`

Send emails related to referral.

**Request Body**:
```json
{
  "type": "intro",
  "recipients": ["agent@example.com"]
}
```

**Response**: Success message

#### `GET /api/referrals/metadata`

Get metadata for autocomplete (sources, endorsers, agent sources).

**Response**:
```json
{
  "sources": ["Source 1", "Source 2"],
  "endorsers": ["Endorser 1"],
  "agentSources": ["Agent Source 1"]
}
```

### Payments API

#### `GET /api/payments`

List payments with filtering.

**Query Parameters**:
- `referralId`: Filter by referral ID
- `status`: Filter by payment status
- `agentId`: Filter by agent ID
- `network`: Filter by network
- `timeframe`: Filter by timeframe

**Response**: Array of payment objects

#### `POST /api/payments`

Create a new payment/deal.

**Request Body**:
```json
{
  "referralId": "referral-id",
  "contractPriceCents": 50000000,
  "commissionBasisPoints": 300,
  "referralFeeBasisPoints": 2500,
  "closingDate": "2024-12-31",
  "side": "buy"
}
```

**Response**: Created payment

#### `PATCH /api/payments/[id]`

Update a payment.

**Request Body**: Partial payment object

**Response**: Updated payment

#### `POST /api/payments/[id]/mark-payment-sent`

Mark payment as sent.

**Request Body**:
```json
{
  "paidDate": "2024-12-31"
}
```

**Response**: Updated payment

#### `POST /api/payments/[id]/send-fee-breakdown`

Send fee breakdown email to agent.

**Response**: Success message

### Agents API

#### `GET /api/agents`

List agents with filtering.

**Query Parameters**:
- `active`: Filter by active status
- `statesLicensed`: Filter by licensed states
- `zipCoverage`: Filter by zip coverage
- `ahaDesignation`: Filter by AHA designation

**Response**: Array of agent objects

#### `GET /api/agents/[id]`

Get a single agent.

**Response**: Agent object with populated user

#### `PATCH /api/agents/[id]`

Update an agent.

**Request Body**: Partial agent object

**Response**: Updated agent

#### `GET /api/agents/[id]/notes`

Get notes for an agent.

**Response**: Array of note objects

#### `POST /api/agents/[id]/notes`

Create a note for an agent.

**Request Body**:
```json
{
  "content": "Note content",
  "hiddenFromAgent": false
}
```

**Response**: Created note

#### `POST /api/agents/[id]/welcome-email`

Send welcome email to agent.

**Response**: Success message

#### `GET /api/agents/coverage-suggestions`

Get AI-powered coverage suggestions for zip codes.

**Query Parameters**:
- `zipCodes`: Comma-separated zip codes

**Response**: Array of coverage suggestions

#### `POST /api/agents/coverage-suggestions/[id]`

Update agent coverage suggestions.

**Request Body**:
```json
{
  "suggestions": ["80202", "80203"]
}
```

**Response**: Updated agent

### Lenders API

#### `GET /api/lenders`

List lenders/MCs.

**Query Parameters**: Similar to agents API

**Response**: Array of lender objects

#### `GET /api/lenders/[id]`

Get a single lender.

**Response**: Lender object

#### `PATCH /api/lenders/[id]`

Update a lender.

**Request Body**: Partial lender object

**Response**: Updated lender

#### `GET /api/lenders/[id]/notes`

Get notes for a lender.

**Response**: Array of note objects

#### `POST /api/lenders/[id]/notes`

Create a note for a lender.

**Request Body**:
```json
{
  "content": "Note content",
  "hiddenFromMc": false
}
```

**Response**: Created note

#### `POST /api/lenders/[id]/welcome-email`

Send welcome email to lender.

**Response**: Success message

### Dashboard API

#### `GET /api/dashboard`

Get dashboard metrics.

**Query Parameters**:
- `timeframe`: 'day', 'week', 'month', 'year', 'ytd', 'all', 'custom'
- `startDate`: Custom start date (ISO string)
- `endDate`: Custom end date (ISO string)
- `network`: 'ALL', 'AHA', 'AHA_OOS'
- `tab`: 'main', 'mc', 'agent', 'admin'

**Response**: Dashboard metrics object

#### `GET /api/dashboard/pre-approvals`

Get pre-approval metrics.

**Query Parameters**: Same as dashboard

**Response**: Pre-approval metrics

### Follow-up Tasks API

#### `GET /api/follow-up-tasks`

Get follow-up tasks for user.

**Query Parameters**:
- `referralId`: Filter by referral ID
- `status`: Filter by task status

**Response**: Array of task objects

#### `GET /api/follow-up-tasks/[referralId]`

Get tasks for a specific referral.

**Response**: Array of task objects

#### `POST /api/follow-up/tasks/complete`

Mark a task as complete.

**Request Body**:
```json
{
  "taskId": "task-id",
  "referralId": "referral-id",
  "completed": true
}
```

**Response**: Success message

#### `POST /api/follow-up/reminders`

Send task reminders (requires authentication secret).

**Request Body**:
```json
{
  "frequency": "daily",
  "tasks": [...],
  "recipient": "user@example.com"
}
```

**Response**: Success message

### Import API

#### `POST /api/imports`

Start an import job.

**Request Body** (multipart/form-data):
- `file`: CSV/XLSX/ZIP file
- `mapping`: JSON string of field mappings
- `type`: 'referrals', 'agents', 'lenders', 'payments'

**Response**: Import job status

#### `POST /api/imports/assist`

Get AI-powered import mapping suggestions.

**Request Body**:
```json
{
  "headers": ["Name", "Email", "Phone"],
  "type": "referrals"
}
```

**Response**: Suggested field mappings

### NPS API

#### `GET /api/nps/validate`

Validate an NPS survey token.

**Query Parameters**:
- `token`: Survey token

**Response**: Token validation result

#### `POST /api/nps/submit`

Submit an NPS survey response.

**Request Body**:
```json
{
  "token": "survey-token",
  "score": 9
}
```

**Response**: Success message

#### `GET /api/nps/agent-name`

Get agent name for survey display.

**Query Parameters**:
- `token`: Survey token

**Response**: Agent name

### Profile API

#### `GET /api/me/profile`

Get current user profile.

**Response**: User object

#### `PATCH /api/me/profile`

Update current user profile.

**Request Body**: Partial user object

**Response**: Updated user

#### `GET /api/me/role`

Get current user role.

**Response**: Role object

#### `PUT /api/me/reminders`

Update reminder settings.

**Request Body**:
```json
{
  "enabled": true,
  "frequency": "daily"
}
```

**Response**: Updated settings

#### `GET /api/profile/metrics`

Get profile-specific metrics.

**Response**: Metrics object

### Admin API

#### `GET /api/admin/notifications`

Get admin notifications.

**Response**: Array of notification objects

#### `POST /api/admin/notifications/read`

Mark notifications as read.

**Request Body**:
```json
{
  "notificationIds": ["id1", "id2"]
}
```

**Response**: Success message

#### `DELETE /api/admin/notifications/[id]`

Delete a notification.

**Response**: Success message

#### `GET /api/admin/exports`

Export data (CSV/Excel).

**Query Parameters**:
- `type`: Export type
- `format`: 'csv' or 'xlsx'

**Response**: File download

#### `GET /api/admin/dashboard-report`

Get comprehensive dashboard report.

**Response**: Report data

### Other API Endpoints

#### `POST /api/inbound-email`

Process inbound email (webhook).

**Request Body**: Email webhook payload

**Response**: Processing result

#### `GET /api/mortgage-market`

Get mortgage market insights.

**Response**: Market data

#### `POST /api/coverage/zip-codes`

Get zip code coverage information.

**Request Body**:
```json
{
  "zipCodes": ["80202", "80203"]
}
```

**Response**: Coverage data

#### `GET /api/cron/follow-up-reminders`

Cron endpoint for follow-up reminders (Vercel Cron).

**Headers**: Requires `x-task-reminder-secret`

**Response**: Processing result

#### `GET /api/cron/closing-reminders`

Cron endpoint for closing reminders (Vercel Cron).

**Headers**: Requires `x-task-reminder-secret`

**Response**: Processing result

## Feature Usage Guides

### Creating a Referral

1. **Navigate** to Referrals page
2. **Click** "New Referral" button
3. **Fill out** required fields:
   - Borrower name, email, phone
   - Property location (zip code)
   - Client type (Buyer/Seller/Both)
   - Loan file number (if MC-originated)
4. **Optional fields**:
   - Timeline
   - Pre-approval amount
   - Estimated purchase price
   - Initial notes
5. **Assign** lender/MC (if not already set)
6. **Click** "Create Referral"

### Assigning an Agent

1. **Open** referral detail page
2. **Click** "Assign Agent" button
3. **Choose** assignment method:
   - **AI Suggestions**: System suggests agents based on coverage
   - **Manual Search**: Search by name, zip, or state
4. **Select** agent from list
5. **Choose** side: Buy, Sell, or Both
6. **Confirm** assignment

**Note**: Assignment triggers SLA tracking start

### Updating Referral Status

1. **Open** referral detail page
2. **Click** status dropdown (top right)
3. **Select** new status
4. **Add** optional notes about status change
5. **Confirm** change

**Status Progression**:
- New Lead → Paired → In Communication → Active Lead → Under Contract → Closed
- Can also move to: Lost or Terminated

### Creating a Deal/Payment

1. **Open** referral that is "Under Contract"
2. **Navigate** to "Deals" tab
3. **Click** "Add Deal" button
4. **Fill out**:
   - Contract price
   - Closing date
   - Commission basis points
   - Referral fee basis points
   - Side (buy/sell)
5. **Save** deal

**Deal Status Updates**:
- Update status as deal progresses: `past_inspection` → `past_appraisal` → `clear_to_close` → `closed`

### Managing Follow-up Tasks

1. **View** tasks on referral detail page (Follow-up Tasks card)
2. **Complete** tasks by clicking checkbox
3. **Add** manual tasks:
   - Click "Add Task"
   - Fill out title, message, due date, priority, category
   - Save
4. **View** all tasks on Follow-up Tasks board (dashboard)

### Using the Import Wizard

1. **Navigate** to Imports page
2. **Click** "Import Data"
3. **Upload** CSV/XLSX/ZIP file
4. **Review** auto-detected headers
5. **Map** fields using AI suggestions or manual mapping
6. **Preview** first 20 rows
7. **Review** AI-standardized data (if available)
8. **Confirm** import
9. **Review** import results and errors

### Viewing Dashboard Metrics

1. **Navigate** to Dashboard
2. **Select** dashboard tab: Main, MC, Agent, or Admin
3. **Choose** timeframe: Day, Week, Month, Year, YTD, All Time, or Custom
4. **Filter** by network: ALL, AHA, or AHA_OOS
5. **Review** metrics and leaderboards

### Sending Fee Breakdown Email

1. **Open** deal that is 7 days before closing
2. **Click** "Send Fee Breakdown" button
3. **Review** email preview
4. **Confirm** send

**Email Includes**:
- Contract price
- Commission amount
- Referral fee amount
- Net amount to agent
- Payment instructions

### Using Mortgage Calculator

1. **Navigate** to Mortgage Calculator (if available in menu)
2. **Enter** loan details:
   - Purchase price
   - Down payment %
   - Interest rate
   - Loan term
   - Property tax rate
   - Insurance, HOA, PMI
3. **View** results:
   - Monthly payment (PITI)
   - Total interest
   - Amortization schedule
4. **Use** additional tools:
   - Extra principal impact
   - Scenario comparison
   - Affordability calculator

## Development Workflow

### Project Structure

```
referralcrm/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── (auth)/         # Auth routes (login, register)
│   │   ├── (dashboard)/    # Dashboard pages
│   │   └── api/            # API route handlers
│   ├── components/         # React components
│   │   ├── agents/         # Agent management
│   │   ├── charts/         # Dashboard charts
│   │   ├── dashboard/      # Dashboard components
│   │   ├── forms/          # Form components
│   │   ├── imports/        # Import wizard
│   │   ├── lenders/        # Lender management
│   │   ├── mortgage/       # Mortgage tools
│   │   ├── referrals/      # Referral components
│   │   ├── tables/         # Data tables
│   │   └── layout/         # Layout components
│   ├── lib/                # Shared libraries
│   │   ├── server/         # Server-side helpers
│   │   └── auth-config.ts   # Auth configuration
│   ├── models/             # Mongoose schemas
│   ├── utils/              # Utility functions
│   └── types/              # TypeScript types
├── scripts/                 # Utility scripts
│   ├── seed.ts             # Database seeding
│   └── reset-reminder-defaults.ts
├── tests/                   # Test files
│   ├── unit/               # Unit tests
│   └── e2e/                # E2E tests
├── public/                  # Static assets
├── .env.example            # Environment variable template
├── docker-compose.yml      # Local MongoDB setup
├── jest.config.ts          # Jest configuration
├── playwright.config.ts    # Playwright configuration
├── next.config.mjs         # Next.js configuration
├── tailwind.config.ts      # Tailwind configuration
└── package.json            # Dependencies
```

### Code Style

- **TypeScript**: Strict mode enabled
- **ESLint**: Next.js recommended rules + custom rules
- **Prettier**: Code formatting
- **Import Order**: Absolute imports preferred (`@/components/...`)

### Git Workflow

1. **Create** feature branch from `main`
2. **Make** changes with descriptive commits
3. **Run** tests: `pnpm test`
4. **Run** linter: `pnpm lint`
5. **Create** pull request
6. **Merge** after review and CI passes

### Adding New Features

1. **Create** feature branch
2. **Add** database model (if needed) in `src/models/`
3. **Create** API route in `src/app/api/`
4. **Build** UI components in `src/components/`
5. **Add** types in `src/types/`
6. **Write** tests in `tests/`
7. **Update** documentation

### Database Migrations

Mongoose handles schema changes automatically. For breaking changes:

1. **Update** model schema
2. **Create** migration script (if needed)
3. **Test** on development database
4. **Run** on staging
5. **Deploy** to production

### Environment-Specific Configuration

- **Development**: `.env.local`
- **Staging**: Vercel environment variables
- **Production**: Vercel environment variables

### Debugging

**Server-side**:
- Check Vercel function logs
- Use `console.log` (removed in production builds)
- Check MongoDB Atlas logs

**Client-side**:
- Use React DevTools
- Check browser console
- Use Next.js error overlay

**Database**:
- Use MongoDB Compass
- Check Atlas metrics
- Review query performance

## Deployment

### Vercel Deployment

1. **Connect** repository to Vercel
2. **Configure** project settings:
   - Framework: Next.js
   - Build Command: `pnpm install && pnpm build`
   - Output Directory: `.next`
   - Install Command: `pnpm install`
3. **Set** environment variables in Vercel dashboard
4. **Deploy** (automatic on push to main, or manual)

### Environment Variables Setup

Copy all variables from `.env.local` to Vercel:

1. **Go** to Project Settings → Environment Variables
2. **Add** each variable for:
   - Production
   - Preview (optional)
   - Development (optional)
3. **Redeploy** after adding variables

### MongoDB Atlas Setup

1. **Create** cluster (free tier available)
2. **Create** database user with read/write access
3. **Whitelist** IP addresses:
   - Vercel IPs (or 0.0.0.0/0 for development)
4. **Get** connection string
5. **Set** `MONGODB_URI` in Vercel

### Vercel Cron Jobs

Cron jobs are configured in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/closing-reminders",
      "schedule": "0 16 * * *"
    },
    {
      "path": "/api/cron/follow-up-reminders",
      "schedule": "5 16 * * *"
    }
  ]
}
```

**Requirements**:
- Set `TASK_REMINDER_SECRET` environment variable
- Cron endpoints must validate secret in headers

### Recommended MongoDB Indexes

Ensure these indexes exist for optimal performance:

```javascript
// Run in MongoDB shell or Compass

// Referrals
db.referrals.createIndex({ status: 1, createdAt: -1 });
db.referrals.createIndex({ lookingInZip: 1 });
db.referrals.createIndex({ lender: 1 });
db.referrals.createIndex({ assignedAgent: 1 });
db.referrals.createIndex({ loanFileNumber: 1 }, { unique: true });
db.referrals.createIndex({ 'borrower.email': 1, createdAt: 1 }, { unique: true });
db.referrals.createIndex({ deletedAt: 1, status: 1, createdAt: -1 });

// Payments
db.payments.createIndex({ referralId: 1, status: 1 });
db.payments.createIndex({ status: 1 });

// Agents
db.agents.createIndex({ statesLicensed: 1 });
db.agents.createIndex({ zipCoverage: 1 });
db.agents.createIndex({ email: 1 }, { unique: true });

// Activities
db.activities.createIndex({ referralId: 1, createdAt: -1 });
```

### Timezone Configuration

All date computations use `America/Denver` timezone. Ensure:

1. **Set** `TZ=America/Denver` in Vercel environment variables
2. **Verify** date calculations in production match expectations
3. **Test** SLA calculations with timezone awareness

### Monitoring & Analytics

- **Vercel Analytics**: Automatic performance monitoring
- **Error Tracking**: Check Vercel function logs
- **Database Monitoring**: Use MongoDB Atlas metrics
- **Custom Logging**: Add logging as needed

## Testing

### Running Tests

```bash
# Run all tests
pnpm test

# Unit tests only
pnpm test:unit

# API tests only
pnpm test:api

# E2E tests only
pnpm test:e2e

# Watch mode
pnpm test:unit --watch

# Coverage
pnpm test:unit --coverage
```

### Test Structure

```
tests/
├── unit/                   # Unit tests
│   ├── dashboard-metrics.test.ts
│   ├── sla-insights.test.ts
│   └── referral-utils.test.ts
└── e2e/                    # E2E tests
    └── referral-flow.spec.ts
```

### Writing Tests

**Unit Tests** (Jest):
```typescript
import { describe, it, expect } from '@jest/globals';

describe('Feature', () => {
  it('should do something', () => {
    expect(result).toBe(expected);
  });
});
```

**API Tests** (Jest + Supertest):
```typescript
import request from 'supertest';

describe('API Endpoint', () => {
  it('should return data', async () => {
    const response = await request(app)
      .get('/api/endpoint')
      .expect(200);
    expect(response.body).toHaveProperty('data');
  });
});
```

**E2E Tests** (Playwright):
```typescript
import { test, expect } from '@playwright/test';

test('user flow', async ({ page }) => {
  await page.goto('/');
  await page.click('button');
  await expect(page.locator('text=Success')).toBeVisible();
});
```

### Test Coverage Goals

- **Unit Tests**: >80% coverage for utilities and server helpers
- **API Tests**: All API endpoints should have tests
- **E2E Tests**: Critical user flows (referral creation, agent assignment, status updates)

## Troubleshooting

### Common Issues

#### MongoDB Connection Errors

**Symptoms**: "MongoServerError: connection timeout" or SSL/TLS errors

**Solutions**:
1. **Check** `MONGODB_URI` is correct
2. **Verify** IP whitelist in Atlas includes Vercel IPs
3. **Check** database user has correct permissions
4. **Verify** network connectivity
5. **Check** SSL/TLS settings in connection string

#### Authentication Issues

**Symptoms**: 401 Unauthorized, session not persisting

**Solutions**:
1. **Verify** `NEXTAUTH_SECRET` is set and consistent
2. **Check** `NEXTAUTH_URL` matches deployment URL
3. **Clear** browser cookies and try again
4. **Check** session configuration in `auth-config.ts`
5. **Verify** MongoDB adapter connection

#### Build Failures

**Symptoms**: Vercel build fails, TypeScript errors

**Solutions**:
1. **Run** `pnpm install` locally to check for dependency issues
2. **Check** TypeScript errors: `pnpm tsc --noEmit`
3. **Verify** all environment variables are set in Vercel
4. **Check** Next.js version compatibility
5. **Review** build logs for specific errors

#### API Route Errors

**Symptoms**: 500 errors, missing data

**Solutions**:
1. **Check** Vercel function logs
2. **Verify** database connection
3. **Check** authentication/authorization
4. **Validate** request body with Zod schemas
5. **Check** error handling in route handlers

#### Email Not Sending

**Symptoms**: Emails not received, SMTP errors

**Solutions**:
1. **Verify** `RESEND_API_KEY` or `EMAIL_SERVER` is set
2. **Check** `EMAIL_FROM` is valid
3. **Verify** Resend domain verification (if using Resend)
4. **Check** SMTP credentials (if using SMTP)
5. **Review** email service logs

#### Import Wizard Issues

**Symptoms**: Import fails, mapping errors

**Solutions**:
1. **Check** file format (CSV/XLSX/ZIP)
2. **Verify** `OPENAI_API_KEY` is set (for AI mapping)
3. **Check** file size limits
4. **Review** mapping configuration
5. **Check** server logs for specific errors

#### Dashboard Metrics Incorrect

**Symptoms**: Wrong numbers, missing data

**Solutions**:
1. **Verify** timeframe filter is correct
2. **Check** network filter (ALL/AHA/AHA_OOS)
3. **Verify** data exists in database for timeframe
4. **Check** MongoDB indexes are created
5. **Review** dashboard calculation logic

#### SLA Calculations Wrong

**Symptoms**: Incorrect SLA times, missing metrics

**Solutions**:
1. **Verify** timezone is set to `America/Denver`
2. **Check** business hours calculation logic
3. **Verify** status change timestamps are correct
4. **Check** SLA storage on status updates
5. **Review** `sla-insights.ts` calculations

### Performance Issues

#### Slow Dashboard Load

**Solutions**:
1. **Add** MongoDB indexes (see [Recommended Indexes](#recommended-mongodb-indexes))
2. **Check** aggregation query performance
3. **Implement** pagination for large datasets
4. **Add** caching where appropriate
5. **Optimize** database queries

#### Slow API Responses

**Solutions**:
1. **Check** database query performance
2. **Add** indexes for frequently queried fields
3. **Implement** response caching
4. **Optimize** data aggregation
5. **Check** Vercel function timeout settings

### Getting Help

1. **Check** this README for relevant sections
2. **Review** error logs in Vercel dashboard
3. **Check** MongoDB Atlas logs
4. **Review** code comments and documentation
5. **Check** GitHub issues (if public)
6. **Contact** development team

## Roadmap

### Planned Features

- **SLA Alert Widgets**: Real-time SLA violation alerts with background job processing
- **Duplicate Detection**: Automatic detection of duplicate referrals within 30 days based on borrower contact info
- **Webhook Integration**: Webhook endpoint for automated status updates from external systems
- **Enhanced E2E Testing**: Expanded Playwright coverage for all critical user flows
- **Advanced Reporting**: Custom report builder with export capabilities
- **Mobile App**: Native mobile app for agents and MCs
- **Real-time Updates**: WebSocket support for live dashboard updates
- **Advanced Analytics**: Predictive analytics and forecasting
- **Integration APIs**: RESTful APIs for third-party integrations
- **Bulk Operations**: Bulk status updates, assignments, and exports

### Known Limitations

- **Email Attachments**: Limited to files stored in Google Cloud Storage
- **Import File Size**: Large imports may timeout (consider chunking)
- **Real-time Updates**: Dashboard requires manual refresh (WebSocket planned)
- **Mobile Experience**: Optimized for desktop, mobile improvements planned
- **Offline Support**: No offline capability currently

## License

MIT © 2024 AFC & AHA

---

## Additional Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [MongoDB Atlas Documentation](https://docs.atlas.mongodb.com/)
- [NextAuth.js Documentation](https://next-auth.js.org/)
- [Vercel Documentation](https://vercel.com/docs)
- [Mongoose Documentation](https://mongoosejs.com/docs/)

For questions or support, please contact the development team.
