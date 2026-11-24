---
name: FUB follow-up evidence and explicit Day 31 decisions
todos:
  - id: source-evidence
    content: Confirm existing automation evidence and implement bounded historical and ongoing collection.
    status: pending
  - id: sop-summary
    content: Expose dated Day 3, Day 7, and Day 31 review evidence with honest coverage and exact review validation.
    status: pending
  - id: explicit-decisions
    content: Store permission-checked Keep/Release decisions with reasons and immutable revision history.
    status: pending
  - id: dashboard
    content: Connect the SOP counts and filtered evidence to the FUB dashboard and add the Day 31 review form.
    status: pending
  - id: verify-release
    content: Test source recognition, access, concurrent decisions, UI flows, then deploy the backend and connected Referrio preview and verify live data.
    status: pending
---

# FUB follow-up evidence and Day 31 decisions

Use the existing FUB Day 3 and Day 7 reminder notes as documented follow-up alerts. These are emitted by the configured FUB rules when Calls Made is below two or four for the covered stages. Display counts and dated customer evidence; do not invent pass rates or infer compliance from a missing reminder. Collect recognized templates without retaining unrelated note wording. Start from actual automation enrollment where supported and expose historical collection progress or limitations.

Use the existing Day 31 review note to open a review. A permitted owner/admin must explicitly record Keep or Release and a reason. Record who decided, when, and every revision. Recent contact, current ownership, stage, and unrelated task completion cannot substitute for the explicit decision. Recording a decision does not modify FUB assignments, stages, or automations.

Keep the dashboard lean: the existing SOP summary and agent table, clickable evidence lists, and the decision form inside the Day 31 evidence view. Decisions are attached to a verified source review, scoped to the existing FUB account and permission, and independent of the selected Day 3/7/call evidence timeframe.

Maintain backward compatibility while deploying the backend before the updated preview. No AI calls, official scoring, email-sync changes, or writes to FUB. First-call timing remains outside this change.
