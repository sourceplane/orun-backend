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
  validation. Task 0020 added queue/DLQ/consumer/cron support to the
  self-hosted CLI bootstrap path. Remaining queue risks: no DLQ replay tooling,
  custom-domain smoke from GitHub Actions is blocked by Cloudflare WAF, and
  disposable live smoke for self-hosted bootstrap has not been run because
  credentials were unavailable.

## Live And Deployment Verification

- Task 0020 resolved the Task 0015 CLI bootstrap gaps by embedding migration
  0006 and adding queue/DLQ/consumer/cron support to
  `orun backend init/status/destroy`.
- Task 0020 resolved the `SetWorkerVars` binding-clobber risk by including
  plain-text vars in the same Worker upload metadata as DO/D1/R2/queue bindings
  on the bootstrap path. The standalone `SetWorkerVars` helper remains outside
  the critical path.
- Disposable live Cloudflare smoke for the self-hosted bootstrap path has still
  not been run because Task 0020 implementer/verifier environments lacked
  Cloudflare credentials. Fake-server tests and dry-run smokes cover the API
  shape, but one isolated live smoke remains useful.
- Shard migration fan-out and D1 read-replication/session behavior remain future
  work. Multi-shard catalog D1 activation is still blocked by
  `ai/proposals/task-0016-spec-update.md`.
- GitHub Actions catalog sync through `https://orun-api.sourceplane.ai` is
  blocked by Cloudflare WAF managed challenge for GHA runner IPs. The workers.dev
  fallback succeeds and should remain the CI-safe smoke target until a WAF policy
  change is explicitly planned.
- **V2 Supabase DB and Hyperdrive not live-verified:** Task 0022 merged PR #40
  and the Postgres migration smoke is green using a disposable container. However,
  the manually created shared Supabase database has not been live-smoked
  (`pnpm --filter @orun/db migrate && pnpm --filter @orun/db smoke` against the
  real `DATABASE_URL`) and the Hyperdrive config (`oruncloud-db`,
  `d8cada8abda7451aaa1e2ce189dc8a17`) has not been inspected via `wrangler`
  because credentials were unavailable. Terraform apply is also blocked until a
  future adoption task imports those resources into state. These are expected gaps
  documented in the Task 0022 verifier report.

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
