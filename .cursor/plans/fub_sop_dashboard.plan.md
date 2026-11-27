---
name: Simplified FUB SOP dashboard
todos:
  - id: stored-summary
    content: Add a bounded, signed, stored-data summary and evidence endpoint in Intelligence.
    status: pending
  - id: dashboard-access
    content: Add a separate owner-managed FUB dashboard permission for active admins.
    status: pending
  - id: fub-tab
    content: Add FUB after Admin with a compact SOP summary, agent table, and evidence drilldowns.
    status: pending
  - id: verification
    content: Test authorization, calculations, incomplete coverage, evidence paging, and dashboard rendering; prepare reviewable PRs.
    status: pending
---

# FUB SOP dashboard

Build a small management view inside Referrio: Main, MC, Agent, Admin, FUB. The account owner has access and explicitly grants a separate dashboard permission to active admins. Existing referral-only FUB grants do not automatically expose the team dashboard.

Use collected Intelligence data through a signed server-to-server endpoint. Do not query FUB from dashboard requests. Do not enable AI, official scoring, email collection, or FUB writes.

Show first-call speed, Day 3 and Day 7 follow-up, past-due task review, next-step evidence, and Day 31 review readiness. Measured counts must distinguish documented evidence from compliance. Unknown delivery/playbook clocks and incomplete coverage cannot become failed SOPs or invented percentages. Surface stored call/task evidence and explain what is needed to measure unavailable standards.

Keep layout lean: a brief collection freshness line, one SOP table and one agent table. Clicking a measured count opens the relevant contacts and dated evidence, with a link to FUB. Keep FUB filters separate from Referrio referral network/timeframe filters. Bound and paginate evidence; preserve account identity, permission checks, private responses, and stored-user revocation checks.

Prepare code and tests for review. Production deployment is a separate release step after the implementation is reviewed.
