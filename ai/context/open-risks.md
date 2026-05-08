# Open Risks

## Current Repo Health

- Repo health is yellow because Task 0019 could not complete a full fresh local
  remote-state conformance run. The available CLI session predates
  Task 0012.2.1 and lacks the `githubUserId` claim needed for
  `POST /v1/accounts/repos/link`. Later namespace/linking follow-ups passed and
  Task 0019 found no P0/P1 implementation failures. One fresh `orun auth login`
  plus local remote-state run can close this bookkeeping risk.
- Storage scalability remains partly deferred: the current production Worker
  still uses a single `DB` binding for core metadata plus catalog/run fallback.
  Task 0016 added the storage router and Task 0018 activated queue-backed
  catalog ingestion, but production catalog shard D1 bindings are still inactive.
- **Cross-shard JOIN gap (HARD BLOCKER for multi-shard):** Catalog read queries
  (`listCatalogComponents`, `getCatalogComponent`, `listCatalogComponentEvents`,
  `listCatalogComponentRecentRuns`) JOIN `namespaces` in the same DB. In
  multi-shard mode namespaces are in core D1 while catalog tables are in shard
  D1s — these JOINs will fail. Any PR adding `DB_CATALOG_0`/`DB_CATALOG_1` to
  `wrangler.jsonc` MUST first implement Option 3 from
  `ai/proposals/task-0016-spec-update.md` (denormalized `namespace_slug` columns).
- **Queue-backed catalog ingestion active:** Task 0018 provisioned
  `orun-catalog-ingest` and `orun-catalog-ingest-dlq`, activated
  `CATALOG_INGEST_QUEUE`, and hardened `namespaceId === repoId` plus upload ID
  validation. Remaining queue risks: no DLQ replay tooling, custom-domain smoke
  from GitHub Actions is blocked by Cloudflare WAF, and queue/DLQ/consumer
  provisioning is not yet represented in CLI self-hosted bootstrap.

## Live And Deployment Verification

- Task 0015 live Cloudflare smoke was not run. Direct REST bootstrap is covered
  by fake-server tests and dry-run smokes, but live provisioning should still be
  tested with disposable Cloudflare resources after Task 0020 adds queues and
  cron.
- Task 0015 verifier noted `SetWorkerVars` PATCH binding behavior remains
  unverified live; Task 0020 should either prove it safe or avoid binding
  clobbering by construction.
- Worker cron trigger configuration is not implemented by CLI bootstrap.
- The `sourceplane/orun` embedded backend bundle currently has only migrations
  0001-0005; production backend main has `0006_tenant_routes.sql`.
- Queue provisioning, queue consumer attachment, cron configuration, shard
  migration fan-out, and D1 read-replication/session behavior are not yet fully
  represented in the self-hosted CLI bootstrap path.
- GitHub Actions catalog sync through `https://orun-api.sourceplane.ai` is
  blocked by Cloudflare WAF managed challenge for GHA runner IPs. The workers.dev
  fallback succeeds and should remain the CI-safe smoke target until a WAF policy
  change is explicitly planned.

## Auth And Session Follow-Ups

- Device-flow endpoint rate limiting was deferred from Task 0010.
- Refresh tokens are not rotated.
- CLI session garbage collection remains deferred.
- `orun cloud link` cannot create new backend repo links without prior dashboard
  setup.
- `orun cloud link --backend-url` is missing; use `ORUN_BACKEND_URL` as the
  current workaround.
- `orun auth token --audience` is display-only.

## Dashboard QA

- Full interactive live visual QA across desktop/tablet/mobile was deferred for
  the dashboard. Run browser checks before relying on the dashboard as visually
  production-ready.
