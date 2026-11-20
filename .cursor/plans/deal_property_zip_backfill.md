# Deal Property ZIP Field and Backfill Plan

Goal: add a dedicated five-digit transaction property ZIP field to deals and backfill verified historical ZIPs into existing deal records.

Base branch: `origin/main`
Feature branch: `codex/deal-property-zips`

## Constraints

- Store ZIPs as strings containing exactly five digits.
- Preserve leading zeros.
- Normalize verified ZIP+4 values to the first five digits.
- Allow blank ZIP values for unresolved historical deals.
- Track provenance as manual, address-extracted, or address-verified.
- Never convert ZIPs to numbers or invent padding.
- Use each deal's own property address only.
- Do not alter original property address fields during backfill.
- Use deterministic extraction first, U.S. Census Geocoder for address verification, and OpenAI only for minimal structured parsing.
- Dry-run by default; apply only with explicit flag and target database confirmation.
- Update only empty ZIP fields and only when the property address still matches discovery.
- Write narrow updates only, avoiding save hooks and notification paths.
- Produce a manifest for audit and rollback.

## Implementation

1. Add ZIP/provenance validation helpers and tests.
2. Add fields to `Payment`, `paymentSchema`, payment serializers, and UI forms/displays.
3. Add backfill helper modules for extraction, normalized address keys, Census lookup, optional OpenAI parsing, planning, apply checks, verification, and rollback.
4. Add dry-run/apply and rollback scripts under `scripts/`.
5. Run focused tests, typecheck, and build sequentially.
6. Verify target DB host/database before writes, run isolated DB test and production dry-run, inspect output, then apply.
7. Verify stored values and commit/push a focused draft PR.
