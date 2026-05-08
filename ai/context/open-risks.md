# Open Risks

## Current Repo Health

- Repo health is yellow because original Task 0012 local conformance verification
  failed and Task 0012.1 has no verifier report. Later namespace/linking
  follow-ups passed, but the whole local conformance phase should be re-verified
  before marking health green.
- Storage scalability is now an explicit design gap: the current Worker code uses
  a single `DB` binding for core metadata, run indexes, and catalog indexes.
  This is acceptable for the shipped bootstrap slice, but high-volume catalog or
  run-ingestion work should first add storage routing, catalog shard support, and
  queue-backed normalization. **Task 0016 added the routing seam and queue path.**
- **Cross-shard JOIN gap (HARD BLOCKER for multi-shard):** Catalog read queries
  (`listCatalogComponents`, `getCatalogComponent`, `listCatalogComponentEvents`,
  `listCatalogComponentRecentRuns`) JOIN `namespaces` in the same DB. In
  multi-shard mode namespaces are in core D1 while catalog tables are in shard
  D1s — these JOINs will fail. Any PR adding `DB_CATALOG_0`/`DB_CATALOG_1` to
  `wrangler.jsonc` MUST first implement Option 3 from
  `ai/proposals/task-0016-spec-update.md` (denormalized `namespace_slug` columns).
- **Queue consumer deferred:** `CATALOG_INGEST_QUEUE` producer is wired (Task
  0016). Consumer (Task 0017) is not yet implemented. Messages accumulate if
  queue binding is configured before the consumer lands.

## Live And Deployment Verification

- Task 0015 live Cloudflare smoke was not run. Direct REST bootstrap is covered
  by fake-server tests and dry-run smokes, but live provisioning should still be
  tested with disposable Cloudflare resources.
- Task 0015 verifier noted `SetWorkerVars` PATCH binding behavior remains
  unverified live.
- Worker cron trigger configuration is not implemented by CLI bootstrap.
- Queue provisioning, shard migration fan-out, and D1 read-replication/session
  behavior are not yet represented in the deployment/bootstrap path.

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
