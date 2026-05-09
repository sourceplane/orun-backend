# Compact Task Ledger

Use this ledger to route attention. Open the full archived task/report only when
the task is directly related to the current change.

## Completed Foundation

| Task | Status | Compact Outcome |
|---|---|---|
| 0001 | PASS, PR #4 | Monorepo scaffold: workspaces, package configs, component wiring, initial CI/devops shape. |
| 0002 | PASS, PR #5 | `@orun/types`: shared type exports and path utilities with zero runtime dependency intent. |
| 0003 | PASS, PR #7 | `RunCoordinator` Durable Object with job lifecycle, runnable/state/cancel, alarms, and tests. |
| 0004 | PASS, PR #8 | `@orun/storage`: R2 object storage, D1 index, initial migrations, storage tests. |
| 0005 | PASS, PR #12 | Worker auth module: GitHub OIDC, session JWTs, GitHub OAuth helpers, auth tests. |
| 0006 | PASS, PR #13 | Worker API gateway integrating auth, coordinator, storage, handlers, rate limiting, scheduled work, and Miniflare coverage. |
| 0007 | PASS, PR #14 | Account/repo linking APIs with GitHub permission checks and namespace/account persistence. |

## Remote State And Deployment

| Task | Status | Compact Outcome |
|---|---|---|
| 0008 | PASS after follow-up | Go CLI remote-state client integration completed after Task 0008.1 remediation. |
| 0008.1 | PASS | Follow-up fix for Task 0008 remote-state behavior. |
| 0008.2 | COMPLETE | Stack-tectonic deployment readiness completed; `oci://ghcr.io/sourceplane/stack-tectonic:0.12.0` released. |
| 0008.3 | COMPLETE | Live Cloudflare deployment completed: Worker, D1/R2, OIDC-ready live backend. |
| 0008.4 | PASS, sourceplane/orun PR #54 | Local state locking added with `flock` cross-process locking; race tests passed. |
| 0008.5 | PASS, sourceplane/orun PR #55 | Remote-state conformance fixed and verified; OIDC workflows and live conformance passed. |

## Dashboard And Auth

| Task | Status | Compact Outcome |
|---|---|---|
| 0009 | PASS, PR #20 | First dashboard UI slice deployed through Cloudflare Pages; OAuth flow code and dashboard/client tests passed. |
| 0010 | PASS, PR #27 | CLI auth backend: browser OAuth loopback, GitHub device flow, Orun access/refresh tokens, session routes, D1 migration 0003. |
| 0011 | PASS, sourceplane/orun PR #83 | `orun auth` and `orun cloud link`; local remote-state token resolution using CLI sessions; GitHub Actions OIDC unchanged. |

## Local Conformance And Namespace Remediation

| Task | Status | Compact Outcome |
|---|---|---|
| 0012 | YELLOW bookkeeping | Original local conformance verifier recorded FAIL. Later follow-ups addressed known blockers, but Task 0012.1 lacks a verifier report. |
| 0012.1 | PARTIAL record | Implementer said harness blockers were addressed; no verifier report is present. Re-verify before declaring the whole phase green. |
| 0012.2 | FAIL then remediated | Backend session repo-link endpoint initially allowed broader linking than spec. Remediated by Task 0012.2.1. |
| 0012.2.1 | PASS, PR #31 | CLI sessions now use `local:user:<githubUserId>:repo:<repoId>` namespaces from account repo cache; canonical repo namespaces stay OIDC-only. |
| 0012.3 | BLOCKED then merged | CLI local namespace auto-resolve was correct but blocked on 0012.2. Merged after 0012.3.1. |
| 0012.3.1 | PASS, sourceplane/orun PR #85 | Local remote-state auto-resolves through `POST /v1/accounts/repos/link`, rejects non-local backend responses, invalidates canonical caches. |

## Catalog And Bootstrap

| Task | Status | Compact Outcome |
|---|---|---|
| 0013 | FAIL then remediated | Catalog index foundation initially accepted missing `component.path`, causing async D1 failure. |
| 0013.1 | PASS | Catalog sync now synchronously rejects missing/non-string `component.path` before `ctx.waitUntil`; regression tests added. |
| 0014 | PASS, PR #33 | Catalog-first dashboard UI using Task 0013 APIs while preserving run/job/log workflows. |
| 0015 | PASS, sourceplane/orun PR #86 | `orun backend init/status/destroy` with embedded backend bundle and direct Cloudflare REST APIs; verifier fixed Worker upload metadata and DO migration tag propagation before merge. |

## Planned Scalable Data Plane

| Task | Status | Compact Outcome |
|---|---|---|
| 0016 | PASS, PR #35 | StorageRouter with FNV hash routing and single-DB fallback; queue-backed ingestion with CATALOG_INGEST_QUEUE; ctx.waitUntil fallback; shard-grouped reads; migrations/0006_tenant_routes.sql. Cross-shard JOIN limitation deferred (proposal at ai/proposals/task-0016-spec-update.md). |
| 0017 | PASS, PR #36 | Worker queue consumer for CatalogIngestMessage: R2 envelope load, defensive validation, shared normalizeComponents, per-message ack/retry. Verifier fixed path-in-logs constraint violation before merge. namespaceId===repoId and uploadId cross-check deferred as risk notes. No queue/shard binding activated. |
| 0018 | PASS, PR #37 | Provisioned orun-catalog-ingest + orun-catalog-ingest-dlq via CF API; CATALOG_INGEST_QUEUE producer/consumer bindings in wrangler.jsonc (batch_size=10, max_retries=3, DLQ); namespaceId/repoId and uploadId cross-checks hardened; log safety fix (opaque reason code); E2E test. POST /v1/catalog/sync -> 202 confirmed via workers.dev smoke (CI run 25544219282). |
| 0019 | PARTIAL | Full-system verification found no P0/P1 implemented failures. Local backend checks, CI/CD, live Cloudflare queue-backed catalog ingestion via workers.dev, dashboard build/live HTML, sourceplane/orun Go checks, and security/data boundaries passed. Partial because fresh CLI login is needed for full local remote-state conformance, browser dashboard visual QA was unavailable, and local CF credentials were absent. P2 gaps: CLI bootstrap lacks queues/cron and embedded bundle has only 5 migrations. |
| 0020 | PASS, sourceplane/orun PR #87 | CLI bootstrap queue provisioning merged as squash commit d8dd132. Embedded migration 0006, queue/DLQ/consumer/cron in init/status/destroy, binding-clobber risk resolved via single-upload plain-text vars. All local checks and dry-run smokes pass. CI green. Live Cloudflare smoke not run (credentials unavailable). |
| 0021 | PASS, PR #39 | `packages/db`/`@orun/db`: Postgres migration harness, `0001_core.sql` (8-table bounded V2 core schema), typed domain row types, CLI scripts, 57 tests. All local and CI checks pass (21/21 orun jobs). Merged as squash commit 238404e. Live DB smoke deferred to Task 0022 (no Docker/local Postgres). |
| 0022 | READY | Prompt created to bring database provisioning early: add Tactonic/Terraform Supabase/Postgres scaffold, plan-first provisioning workflow using `SUPABASE_API_KEY`, and PR-safe real Postgres migration smoke for `@orun/db`. Must not wire Worker/Hyperdrive or change V1 behavior. |
