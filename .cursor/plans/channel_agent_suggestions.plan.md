---
name: Channel-specific agent suggestions and OOS handoff
todos:
  - id: suggestions
    content: Match OOS agents by closed-deal ZIP, then coverage, with a 15-mile fallback and destination-state licensing; ignore ZIP for AHA and exclude Adam Pippin and Kristen Truong.
    status: pending
  - id: handoff
    content: Enable OOS paired handoffs and always assign the FUB customer to Kristen while retaining the paired Referrio agent.
    status: pending
  - id: verification
    content: Cover geographic priority, licensing, channel routing, and FUB assignment with regression tests and run TypeScript checks.
    status: pending
---

Preserve current pairing criteria within each OOS geographic tier: exact closed-deal ZIP, exact coverage, nearby closed-deal ZIP, nearby coverage. Require a recorded license for the matched destination state. Use payment records for closed-deal geography, including legacy side-agent attribution, and exclude outside-agent deals and deleted referrals.

AHA email routing remains authoritative regardless of the looking-in ZIP. Rank active AHA agents with the current non-geographic criteria, excluding Adam Pippin and Kristen Truong.

Resolve Kristen uniquely in the verified FUB account and stop the handoff if her identity is missing or ambiguous. Preserve the selected Referrio agent and existing handoff retry protections.
