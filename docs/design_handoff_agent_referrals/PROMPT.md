# Cursor prompt

Paste this into Cursor with the handoff folder open in the workspace (or drag `README.md` in as context).

---

You're implementing an approved redesign of the agent-facing referral experience in this Next.js app. The design spec is `README.md` in this handoff folder; the two HTML files next to it are visual references — open them in a browser to see the intended result. They are static prototypes, not code to copy. Do not port their inline styles; map every value to this codebase's Tailwind theme and existing UI primitives.

Read `README.md` fully before writing code, then read these files to learn the current implementation and conventions:

- `src/app/(dashboard)/referrals/page.tsx`
- `src/components/tables/referral-table.tsx`
- `src/components/forms/referral-filters.tsx`
- `src/app/(dashboard)/referrals/[id]/page.tsx`
- `src/components/referrals/referral-detail-client.tsx`, `referral-header.tsx`, `referral-notes.tsx`, `referral-timeline.tsx`, `referral-deals.tsx`, `deal-card.tsx`, `status-changer.tsx`
- `src/components/layout/sidebar.tsx`
- `src/constants/referrals.ts`
- `src/utils/sla-insights.ts`
- `tailwind.config.ts` and `docs/theme.md`

There are three screens: **1a** the referral list on phone, **2a** the same list on desktop, **3a** the referral detail page. 1a and 2a are one responsive route (`/referrals`); 3a is `/referrals/[id]`. The spec gives exact colors, type sizes, grid definitions, control heights, and copy — follow them precisely. Reuse existing components wherever they already produce the specified result and only add styling where they don't.

Build in this order, and stop after each step so I can review before you continue:

1. **Data layer.** Extend the referral list response with the fields under *Data requirements* in the spec: `needsUpdate`, `daysInStatus`, `statusChangedAt`, `lastActivity`, `latestDeal`, `counterparty`, `referredAt`. Derive `needsUpdate` in `src/utils/sla-insights.ts` so the list and detail views can't disagree. Add the grouping and sort described there. No UI changes in this step.
2. **2a — desktop list.** Replace the filter card with the single toolbar row, add the grouped rows on the shared four-column grid, and implement expand-in-place for Update status and Add note plus the Select bulk mode. Add the needs-update count badge to the sidebar's Referrals item and drop the app icon and product sub-label from the sidebar header per the spec.
3. **1a — phone list.** Same route, below ~1024px: the card list, not a horizontally scrolling table.
4. **3a — detail page.** Three cards (Where are they now? / Activity / Deals) plus the context rail. Merge notes and status history into one activity stream, turn the status select into a chip row, and convert the deal cards into table rows with their per-deal actions moved into a kebab menu.

Rules while you work:

- Use the copy strings from the spec verbatim.
- Keep the app's existing focus ring, empty states, skeletons, and toast patterns. Phone hit targets stay at or above 44px.
- All numbers, dates, and IDs render in IBM Plex Mono with tabular numerals.
- Status chips must render the canonical statuses from `src/constants/referrals.ts` through a display-label helper. The prototypes show agent-facing labels ("Matched with MC", "MC reached out", "Working with MC") that are not in that constant — tell me the mapping you'd use and wait for confirmation before hardcoding it.
- Don't refactor anything the spec doesn't touch. Don't add features that aren't in it.
- Status changes and note saves should be optimistic with a toast on failure. A status needing a date or a lost/termination reason routes through the existing confirmation flow rather than blocking the chip row.

Four decisions are still open (they're listed at the end of the spec): the status mapping above, whether the notification bell lives in the content header or the sidebar, expand-in-place versus a right-side panel on desktop, and whether Deals collapses behind a tab on phone. Build what the spec shows for each and flag them in your summary; don't invent alternatives.

When you're done with a step, tell me what changed, what you had to deviate from and why, and anything in the spec that conflicted with the codebase.
