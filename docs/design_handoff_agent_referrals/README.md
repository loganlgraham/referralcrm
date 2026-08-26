# Handoff: Agent referrals redesign (1a, 2a, 3a)

## Overview

Three designs that replace the agent-facing referral experience in the Referrio "Handoff Desk" app:

| Id | Screen | Viewport |
|----|--------|----------|
| **1a** | Referral list — phone | 390 × 844 |
| **2a** | Referral list — desktop | 1440 × 900 (256px sidebar + fluid content) |
| **3a** | Referral detail — desktop | 1184px content pane (sidebar unchanged from 2a) |

Problem being solved: agents ignore the current referrals screen. It opens with a filter card and a four-metric strip, the rows carry no context (no days-in-stage, no last note, no deal stage), and the two things an agent actually does — move a status, leave a note — require opening a detail page and scrolling past four cards. The redesign puts the next action on the row, groups by who the referral is waiting on, and surfaces last activity without a tap.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior. They are not production code to copy. Recreate them inside the existing Next.js app (see *Target codebase* below) using its established components, Tailwind theme, and data layer. Do not port the inline styles; map each value to the app's existing token/utility.

The prototypes are **static**: no state, no data fetching, buttons are inert. Sample data is copied from a real referral (Logan Test) and from the live screenshot of `/referrals`.

## Fidelity

**High fidelity.** Colors, type, spacing, and radii are final and specified exactly below. Layout should be recreated closely; substitute the codebase's own primitives (`ui/button`, `ui/badge`, `ui/status-pill`, `ui/card`, `ui/toolbar`, `ui/pill-tabs`, `ui/table-shell`) wherever they already produce the specified result, and only add new styling where they don't.

## Target codebase

Local folder: `referralcrm` — Next.js App Router + TypeScript + Tailwind + MongoDB/Mongoose.

| Design | Route | Existing files most affected |
|--------|-------|-----------------------------|
| 1a, 2a | `/referrals` | `src/app/(dashboard)/referrals/page.tsx`, `src/components/tables/referral-table.tsx`, `src/components/forms/referral-filters.tsx`, `src/components/tables/pagination.tsx` |
| 3a | `/referrals/[id]` | `src/app/(dashboard)/referrals/[id]/page.tsx`, `src/components/referrals/referral-detail-client.tsx`, `referral-header.tsx`, `referral-notes.tsx`, `referral-timeline.tsx`, `referral-deals.tsx`, `deal-card.tsx`, `status-changer.tsx` |
| shared chrome | — | `src/components/layout/sidebar.tsx`, `notification-bell.tsx`, `introduce-client-cta.tsx` |
| statuses | — | `src/constants/referrals.ts` |

`src/components/referrals/referral-header.tsx` already renders a "N days in stage" chip — reuse that computation.

## Design tokens

Lift these into the Tailwind theme if equivalents don't already exist (`tailwind.config.ts`, `docs/theme.md`).

### Color

| Role | Hex |
|------|-----|
| Ink / primary text, primary button, sidebar bg | `#0F1729` |
| Heading ink | `#181B2A` |
| Body secondary | `#596078` |
| Body tertiary / meta | `#878FA6` |
| Hairline border (default) | `#DFE3EC` |
| Hairline border (emphasis) | `#CDD1DF` |
| Hairline inside tables | `#EEF0F5` |
| Surface | `#FFFFFF` |
| App background / inset panels | `#F5F6FA` |
| Canvas (outside frames) | `#E9EBF2` |
| Brand accent (CTA, alert dot, group marker) | `#E2694B` |
| Brand accent hover | `#B9472E` |
| Info pill bg / text | `#E6F1FE` / `#0859C4` (ring `rgba(8,89,196,0.25)`) |
| Warning pill bg / text | `#FDF3DD` / `#924F0C` (ring `rgba(146,79,12,0.3)`) |
| Avatar chip bg | `#E4E8F1` |

Sidebar-only: text `#FFFFFF`, muted text `rgba(255,255,255,0.7)`, icon `rgba(255,255,255,0.4)`, label `rgba(255,255,255,0.4)`, divider `rgba(255,255,255,0.1)`, hover fill `rgba(255,255,255,0.1)`, active item = white fill + `#0F1729` text.

### Type

- Sans: **Manrope** 400/500/600/700/800, `font-feature-settings: 'cv11','ss01'`.
- Mono: **IBM Plex Mono** 400/500/600 — used for all numbers, dates, IDs, and eyebrow labels. Always `font-variant-numeric: tabular-nums` on numerals.

| Use | Size / weight / tracking |
|-----|--------------------------|
| Page H1 (desktop list) | 30px / 800 / -0.035em |
| Page H1 (detail) | 32px / 800 / -0.035em |
| Page H1 (phone) | 26px / 800 / -0.035em |
| Card heading | 16px / 700 / -0.02em |
| Row title (client name) | 17px / 700 / -0.02em |
| Body | 14–15px / 400–500, line-height 1.45 |
| Meta / secondary | 13px / 400 |
| Micro meta | 12px |
| Eyebrow label (mono, uppercase) | 10–11px / 600 / 0.18em |
| Sidebar group label (mono, uppercase) | 9px / 500 / 0.12em |
| Status pill | 12px / 500–600, line-height 16–18px |

### Radius, shadow, control sizes

- Radius: pill `9999px`; buttons/inputs `10px`; rows and cards `14px`; frame `16px`; phone frame `22px`; small icon button `9px`.
- Card shadow (resting): `0 1px 2px rgba(20,20,60,0.04)`.
- Card shadow (raised / needs-action): `0 1px 2px rgba(20,20,60,0.04), 0 10px 30px -14px rgba(20,20,60,0.14)`.
- Primary button shadow: `0 1px 2px rgba(15,23,42,0.16), 0 6px 16px -8px rgba(15,23,42,0.55)`.
- Input inner shadow: `inset 0 1px 1px rgba(15,23,42,0.03)`.
- Secondary button border via `inset 0 0 0 1px #DFE3EC`.
- Heights: primary/secondary button 40px (44–48px on phone), filter pill 36px (34px phone), input 36–40px, notify chip 30px, icon button 34–40px.
- Spacing scale in use: 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32.

## Screen 1a — Referral list, phone (390 × 844)

Top-to-bottom, all full width:

1. **App bar**, 64px, `#0F1729`: Referrio wordmark only (20px, no square app icon) left; notification bell (40×40, `#E2694B` dot when unread) and hamburger (40×40, `rgba(255,255,255,0.2)` border) right.
2. **Header block**, white, bottom hairline, padding 18/16/0:
   - H1 "My referrals".
   - Sub: "**2 need an update** from you. Everything else is moving." — count bolded `#181B2A`, rest `#596078`, 15px.
   - Filter row (14px above, 14px below): pills "Needs update · 2" (active, `#0F1729` fill, white text), "All · 3", "Closed", then a 34×34 search icon pill. Pills must fit 390px without horizontal scroll — do not add a fourth text pill on phone.
3. **List**, padding 16, gap 12, on `#F5F6FA`:
   - Group header "WAITING ON YOU" — mono eyebrow, `#596078`, 2px `#E2694B` left border, 10px left padding.
   - Two **action cards** (white, radius 16, raised shadow):
     - Row 1: client name (17/700, link) + right-aligned status pill.
     - Row 2 (13px, `#596078`): "No note since the intro — **17 days** in this status" (the day count in mono `#924F0C`).
     - Row 3 (13px, `#878FA6`): "Logan MC · Email · Call" — Email/Call are links, `#0F1729`, 500.
     - Action grid: two equal 44px buttons — "Update status" (primary) and "Add note" (secondary).
   - Group header "MOVING ALONG" — same, `#CDD1DF` border, `#878FA6` text.
   - One **quiet card** (no shadow, no buttons): name + "Under Contract" pill, then "Deal stage: **Past inspection** · note 4d ago".
4. **Footer**, white, top hairline: full-width 48px `#E2694B` CTA "Introduce a client to AFC" with send icon; hover `#B9472E`.

Removed from today's phone view: the filter card and the four-metric strip.

## Screen 2a — Referral list, desktop (1440 × 900)

**Left sidebar**, 256px, `#0F1729`, unchanged from production except one addition — a count badge:

- Header 72px, padding `0 24px`: Referrio wordmark only (24px/700/-0.035em) — no square app icon, no product sub-label. The 24px left padding puts the wordmark on the same left edge as the nav icons below it.
- CTA "Introduce a client to AFC" (`#E2694B`, radius 10, 12/16 padding).
- Nav groups WORK (Referrals, Deals) / PEOPLE (Find Referral Agent) / TOOLS (Mortgage Market, Mortgage Calculator) / ACCOUNT (My Profile). Active item = white fill, `#0F1729` text, 600.
- **New:** the active "Referrals" item carries a right-aligned needs-update badge — 20px pill, `#E2694B`, white mono 11px. Count = referrals needing an agent update.
- Footer: avatar chip "LO" + "Logan OOS / Agent".

**Content header**, white, bottom hairline, padding 24/32/0:

- H1 "My referrals" + sub line (same copy as 1a, 15px).
- Notification bell moved here: 38×38, radius 10, `#DFE3EC` border, `#E2694B` dot. *(Decision to confirm: production keeps the bell in the sidebar header.)*
- **Toolbar row**, 18px below the title, 14px bottom padding, single row, `gap: 8px`:
  filter pills "Needs update · 2" (active) / "All · 3" / "Under contract · 1" / "Closed" → flex spacer → 280px search input (36px, radius 9999, leading magnifier icon, placeholder "Search name, email, loan #") → "Select" button (enters bulk mode).
  This replaces the entire filter card (`referral-filters.tsx`) — search, status select, side select, sort.

**List**, padding 24/32/0, gap 10, on `#F5F6FA`. Every row and the column-label row share one grid:

```
grid-template-columns: minmax(0,1fr) 176px minmax(0,1fr) 300px;
gap: 20px;
```

- **Column labels** (mono eyebrow, `#878FA6`): CLIENT · STATUS · LAST ACTIVITY · (blank).
- **Group header** "WAITING ON YOU 2" — `#E2694B` left border, count in mono.
- **Action row** (white card, radius 14, raised shadow, padding 16/20, items centered):
  1. *Client*: name (17/700) + "Buyer · handed to **Logan MC** · 8/8/2026" (13px, mono date).
  2. *Status*: pill, then "**17 days** in status" (12px `#924F0C`, mono number).
  3. *Last activity*: "No note since the intro." + "Email · Call" links.
  4. *Actions*, right-aligned, `gap: 8px`: "Update status" (primary 40px), "Add note" (secondary 40px), 36×40 kebab. All action buttons are `white-space: nowrap; flex-shrink: 0` — the 300px column exists so the labels never wrap.
- **Expanded row** (second row shows this state): same top row, then an inset panel (`#F5F6FA`, top hairline, padding 16/20/18) split `minmax(0,1fr) 300px`:
  - left, under eyebrow "WHERE ARE THEY NOW?": status chips, 34px, radius 9999 — current status is a filled info pill, the rest are `#CDD1DF`-bordered buttons, "Lost" is muted.
  - right, under eyebrow "NOTE": 40px text input, placeholder "Add a note…" (generic — not the MC's name), + 40px "Save" primary.
- **Group header** "MOVING ALONG 1" — `#CDD1DF` border.
- **Quiet row**: same grid, no shadow; status column shows the pill + "Deal stage: **Past inspection**"; activity column shows the last note in quotes + "Logan MC · 4d ago"; actions column has only "Add note" + kebab.
- Footer line: "Showing all 3 referrals." (13px `#878FA6`) — pagination only appears past one page.

## Screen 3a — Referral detail (1184px content pane)

Replaces six equal-weight cards with three, ordered action → history → money, and a context rail. Sidebar unchanged from 2a.

**Header**, white, bottom hairline, padding 20/32/16:

- Breadcrumb "Referrals / Logan Test" (13px; "Referrals" is a link).
- Eyebrow (mono, uppercase, `#596078`): "BUYER · REFERRED TO LOGAN MC" — the detail page says *referred to*, the list rows say *handed to*; align on one before building.
- H1 client name, 32px/800/-0.035em.
- Right-aligned actions: "Email" and "Call" secondary buttons (40px, leading icon) + 40×40 kebab.
- **Fact chips** row, 14px below, `gap: 8px`, all 18px line-height pills: status (warning pill "Under Contract"), "**28 days** in stage" (day count mono `#924F0C`), address, "Loan 2390948203948" with copy icon. Non-status chips are `#F5F6FA` with `inset 0 0 0 1px #DFE3EC`.

**Body**, padding 24/32, `grid-template-columns: minmax(0,1fr) 340px`, `gap: 24px`, `align-items: start`.

Left column (`gap: 16px`):

1. **Where are they now?** (raised card, `#CDD1DF` border, padding 18/20)
   - Heading + right-aligned "Set by Logan Admin · Jul 28, 2026" (13px `#878FA6`, mono date).
   - Status chip row, 36px chips: current status is a filled warning pill (700), others are `#DFE3EC`-bordered buttons with `#596078` text, "Lost" muted. One click = one status change (replaces the `<select>` in `status-changer.tsx`).
2. **Activity** (card, padding 18/20)
   - Heading + "Notes and status changes, newest first."
   - Composer: 72px min-height textarea, placeholder "Add a note with borrower updates or next steps".
   - Below it: "Notify" label + three 30px chips — "Logan MC" (on, `#0F1729`), "Admin", "Me" — then right-aligned 38px "Save note" primary. This replaces the three labeled toggles and the Cancel button.
   - Timeline entries, gap 14, each a 9px dot + text: status changes get a `#924F0C` dot, notes and system events `#CDD1DF`. Entry = 14px primary line, then 13px `#878FA6` byline "Author · date [· Edit]". Merges `referral-notes.tsx` and `referral-timeline.tsx` into one stream.
3. **Deals** (card)
   - Header: "Deals" + "Contracts and payouts tied to this referral." + right-aligned 36px "Add deal".
   - Table grid, used by the label row and every deal row:
     `grid-template-columns: minmax(0,1fr) 150px 130px 120px 40px; gap: 16px;`
     Labels: DEAL · CLOSING · FEE · EXPECTED (right-aligned) · (kebab).
   - Row: "Under Contract · $500,000.00" (14/600) over "Buy-side · 123 Main St. · financing with AFC" (13px `#878FA6`); closing date (mono 13px); "25% of 3.00%"; expected payout right-aligned mono 15/600; kebab.
   - Terminated rows render entirely in `#878FA6` with the reason inline in `#B9472E` ("Reason: **Inspection** · created May 26, 2026") and `$0.00` expected.
   - The per-deal "Update stage" / "Termination reason" selects and the Payment Sent / Edit / Delete buttons move into the kebab menu (or an inline expand) instead of sitting open on every deal.

Right rail (`gap: 16px`, each a plain card padding 18/20):

1. **Who's on it** — "MORTGAGE CONSULTANT" eyebrow, name (15/700), email + phone (13px, `overflow-wrap: anywhere`), then two half-width 36px "Email"/"Call" buttons. Divider, then "BUY-SIDE AGENT" with name + "· you" and email.
2. **Intake details** — heading + "Edit" link; two-column `<dl>`, `gap: 14px 16px`: Client, Loan type, Pre-approval, Looking in, Stage on transfer, Timeline, Entered CRM, Current address. Labels 12px `#878FA6`, values 14/600 (mono for numbers, `#878FA6` when "Not specified").
3. **Client contact** — email + phone, 13px, line-height 1.6.

## Interactions & behavior

- **Filter pills** (1a/2a): single-select, client-side over the loaded page; active = ink fill. "Needs update" is the default landing filter and must be derivable server-side (see data below).
- **Update status** (2a): expands the row in place — no navigation, no modal. Only one row expanded at a time; chip click writes the status, collapses the row, and the row leaves the "Waiting on you" group with a brief highlight. *(Open decision: expand-in-place vs. a right-side panel carrying full history.)*
- **Add note** (2a): expands the same inset panel focused on the note input. Enter or "Save" submits; the row's Last activity column updates to the new note.
- **Select** (2a): toggles bulk mode — checkboxes appear at the left of each row and a footer bar shows "N selected" + "Update N referrals". Bulk action applies one status to the selection.
- **Status chips** (3a): optimistic update, toast on failure; a status that requires a date or a lost/termination reason opens the existing confirmation flow (`status-date-confirmation-toast.tsx`) rather than blocking the chip row.
- **Notify chips** (3a): multi-select, default = MC on, Admin off, Me off (matching today's defaults). Value posts with the note.
- **Deal kebab** (3a): menu with Payment sent · Edit deal · Update stage · Set termination reason · Delete deal (destructive, `#B9472E`, confirm).
- **Hover**: secondary buttons and rail buttons → `#F5F6FA`; sidebar items → `rgba(255,255,255,0.1)`; accent CTA → `#B9472E`; links underline with `rgba(24,27,42,0.4)`, 3px offset.
- **Focus**: keep the app's existing focus ring; every chip, pill, and kebab must be keyboard reachable, and the phone targets stay ≥44px.
- **Responsive**: below ~1024px, 2a collapses to the 1a card list (not a horizontally scrolling table). 3a collapses to one column with the rail cards after the Deals card. *(Open decision: whether Deals collapses behind a tab on phone.)*
- **Empty / loading**: use the existing `ui/empty-state` and `ui/skeleton`. Empty "Needs update" state should say everything is moving rather than showing a blank list.

## State

List (1a/2a): `activeFilter`, `query`, `expandedRowId | null`, `expandedMode: 'status' | 'note'`, `selectMode: boolean`, `selectedIds: Set<string>`, `pendingStatusById`.

Detail (3a): `status`, `pendingStatus`, `noteDraft`, `notify: {mc, admin, me}`, `activity[]` (notes + status events merged, sorted desc), `openDealMenuId`.

## Data requirements

Per referral in the list response — the columns are the point of the redesign, so these must come from the API, not be computed client-side per row:

- `needsUpdate: boolean` — waiting on the agent. Proposed rule: status is active **and** (no note since the last status change **or** days-in-status exceeds the SLA threshold). `src/utils/sla-insights.ts` already computes `hoursSinceLastNote`, `statusAgeDays`, and `hoursSinceStatusUpdate` — derive it there so list and detail agree.
- `daysInStatus: number`, `statusChangedAt`.
- `lastActivity: { text, authorName, at }` — most recent note, or null.
- `latestDeal: { status, stage, closingDate }` for the "Deal stage: …" line.
- `counterparty: { name, email, phone }` (MC) and `referredAt`.

Group order is fixed: **Waiting on you** first, then **Moving along**; within a group sort by `daysInStatus` desc.

## Copy

Use the strings exactly as written in the prototypes: "My referrals", "**2 need an update** from you. Everything else is moving.", "Needs update", "All", "Under contract", "Closed", "Waiting on you", "Moving along", "Update status", "Add note", "Where are they now?", "Add a note…", "Activity", "Notes and status changes, newest first.", "Notify", "Save note", "Deals", "Contracts and payouts tied to this referral.", "Add deal", "Who's on it", "Intake details", "Client contact", "Introduce a client to AFC", "Showing all 3 referrals."

## Open questions for the team

1. **Status vocabulary.** The prototypes show the agent-facing labels from the live screenshot ("Matched with MC", "MC reached out", "Working with MC", "Under contract", "Closed", "Lost"). `src/constants/referrals.ts` defines the canonical set: New Lead, Paired, In Communication, Active Lead, Under Contract, Closed, Lost, Terminated. Confirm the mapping before building the chip rows — the chips should render the canonical statuses through a display-label function, not new values.
2. Notification bell in the content header (as designed) or back in the sidebar header (as in production)?
3. Row expand-in-place vs. right-side detail panel on desktop.
4. Does Deals collapse behind a tab on phone?

## Files in this bundle

- `Referrals - Rethink.dc.html` — 3a (top), 2a, then 1a/1b/1c. Open in a browser; pan/zoom canvas.
- `Referrals - Current.dc.html` — faithful recreation of today's `/referrals` screen, for before/after comparison.
- `support.js` — runtime needed by both HTML files (not part of the design).

Screenshots are not included; ask if they'd help.
