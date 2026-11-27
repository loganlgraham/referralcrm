# Verify and release Referrio

1. Compare the working tree, latest repository source, and current production deployment to confirm the release includes the intended search and previously completed CRM/FUB/database work.
2. Run the full unit suite, appropriate API and browser checks, TypeScript validation, and lint checks. Resolve relevant failures before release.
3. Verify MongoDB connectivity/recovery and query performance, production configuration, and Follow Up Boss read access. Exercise write behavior only against isolated mocks or fixtures.
4. Build the release with production configuration, verify the staged deployment and its real read paths, then publish the verified build to referrio.app.
5. Verify the production domain, authenticated app/database/FUB responses, and runtime errors; record the release result and any measured limits.
