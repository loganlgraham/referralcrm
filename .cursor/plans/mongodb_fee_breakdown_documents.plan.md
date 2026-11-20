# MongoDB Fee Breakdown Documents Implementation Plan

**Goal:** Move the two fee-breakdown PDF attachments from repository files into private MongoDB storage while preserving manual and cron-triggered fee breakdown emails.

**Architecture:** Store each PDF as a small BSON `Buffer` document keyed by stable document key and version. A server-only loader validates both stored PDFs before returning Resend attachment payloads, and the send route refuses to send or mark anything sent if either attachment is missing or corrupt. A one-off migration script uploads the current files idempotently, verifies read-back byte-for-byte, then the branch removes the PDFs and prevents accidental recommits.

**Tech Stack:** Next.js App Router, Mongoose, MongoDB BSON binary storage, Resend attachments, Jest, tsx scripts.

## Global Constraints

- Do not expose a public download endpoint.
- Do not add GridFS for these ~197 KB and ~561 KB PDFs.
- Do not send real test email; mock the email provider and inspect attachment payloads.
- Do not print document contents, banking information, credentials, or connection strings.
- Existing production code keeps bundled PDFs until this branch is released; uploading documents is the only authorized production data change.
- Do not touch FUB, routing, AI features, scoring, email ingestion/syncing, or schedules.
- Keep the PR focused, draft, unmerged, and deployment unchanged.

## Tasks

### Task 1: Add Document Store And Loader Tests

**Files:**
- Create: `tests/unit/fee-breakdown-documents.test.ts`
- Create: `tests/unit/fee-breakdown-document-migration.test.ts`

**Test coverage:**
- Loads both expected attachments in order with exact filename and bytes.
- Rejects missing documents before send.
- Rejects corrupt content, wrong MIME type, wrong byte length, or wrong SHA-256.
- Surfaces database failures as clear attachment-loader failures.
- Migration planning is idempotent, skips identical content, refuses silent overwrite of different content, validates PDF signatures, and verifies read-back integrity.

### Task 2: Implement Private MongoDB Document Store

**Files:**
- Create: `src/models/server-document.ts`
- Create: `src/lib/server/fee-breakdown-documents.ts`
- Create: `src/lib/server/fee-breakdown-document-migration.ts`
- Modify: `src/lib/mongoose.ts`

**Behavior:**
- Store `key`, `version`, `filename`, `mimeType`, `content`, `byteLength`, `sha256`, and `uploadedAt`.
- Use unique index on `{ key: 1, version: 1 }`.
- Validate `%PDF-` signatures and exact SHA-256/byte length on read.
- Return only in-memory attachment buffers to server callers.

### Task 3: Add And Verify Migration Script

**Files:**
- Create: `scripts/migrate-fee-breakdown-documents.ts`
- Modify: `package.json`

**Behavior:**
- `--dry-run` reports actions without writes.
- `--execute` uploads missing documents and skips identical documents.
- `--confirm-host=<host>` and `--confirm-db=<db>` must match the actual connected database before writes.
- Different existing content fails loudly and does not overwrite.
- Script reads both documents back and verifies byte-for-byte integrity.

### Task 4: Integrate Fee Breakdown Route

**Files:**
- Modify: `src/app/api/payments/[id]/send-fee-breakdown/route.ts`
- Create: `tests/unit/send-fee-breakdown-route.test.ts`

**Behavior:**
- Replace filesystem reads with the shared MongoDB loader.
- Load and validate both attachments before cron claim and before Resend send.
- Preserve recipients, subject/body, permissions, duplicate-send protection, verification tokens, and activity logging.
- Return a clear error without sending email, creating an incomplete verification, or marking sent if documents are missing/corrupt/unavailable.
- Test manual and cron-authenticated requests with mocked email provider and inspected attachments.

### Task 5: Upload, Backup, And Remove Files

**Files:**
- Remove: `AHA Commission Wiring Instructions.pdf`
- Remove: `AHA W9 2026.pdf`
- Modify: `.gitignore`

**Steps:**
- Compute size and SHA-256 for both source PDFs without printing contents.
- Run migration dry-run against the intended production host/database.
- Run migration execute using the authorized production MongoDB connection.
- Verify read-back output confirms byte-for-byte integrity.
- Copy the original PDFs to an external backup directory outside the repository.
- Remove the PDFs from the branch only after successful read-back verification.
- Add exact `.gitignore` entries for the two filenames.

### Task 6: Verification And Draft PR

**Commands, run sequentially:**
- `pnpm test:unit --runInBand tests/unit/fee-breakdown-documents.test.ts tests/unit/fee-breakdown-document-migration.test.ts tests/unit/send-fee-breakdown-route.test.ts`
- `pnpm test:unit --runInBand`
- `pnpm exec tsc --noEmit`
- `pnpm build`

**Delivery:**
- Commit focused changes.
- Push `codex/mongodb-fee-documents`.
- Open a draft PR and leave it unmerged.
- Report migration command, upload/read-back results, tests, PR link, and rollback steps.
