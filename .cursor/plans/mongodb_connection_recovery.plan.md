# MongoDB connection recovery and release cleanup

1. Diagnose production failures and compare the saved preview patch with the released connection lifecycle.
2. Serialize health checks, reconnects, retries, and cache updates; preserve one shared client and add safe failure diagnostics.
3. Add regression coverage for concurrent cold starts, stale health checks, disconnect/retry races, and recovery after failure. Run focused tests, unit suite, typecheck, and build sequentially.
4. Release the verified fix and inspect production behavior, keeping database access rules and unrelated feature settings unchanged.
5. Confirm Referrio PRs #266, #267, and #268 are superseded by #269 and close those drafts without merging or deleting branches.
