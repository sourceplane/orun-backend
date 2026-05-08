# Current AI Context

This is the default starting context for planning agents. Read this file, then
`task-ledger.md`, `decisions.md`, and `open-risks.md` before opening historical
task prompts or implementation reports.

## Repo Goal

Build a Cloudflare-first Orun control plane monorepo:

- Worker API on Cloudflare Workers
- Durable Object run coordinator
- D1/R2 persistence
- GitHub OIDC plus local CLI auth
- dashboard catalog and CI intelligence surface
- CLI integration for remote state and self-hosted backend bootstrap

## Current State

- Current task pointer: task 0022
- Last verified: 2026-05-08
- Repo health: yellow
- Live Worker: `https://orun-api.sourceplane.ai`
- Live Dashboard: `https://orun-dashboard.sourceplane.ai`
- Stack version: `oci://ghcr.io/sourceplane/stack-tectonic:0.12.0`
- Next focus: Task 0022 — Tactonic/Supabase provisioning component and CI plan workflow.

Repo health is yellow because Task 0019 could not complete a fresh live local
remote-state conformance run: the available CLI session predates
Task 0012.2.1 and lacks the `githubUserId` claim. Later remediation tasks
passed, and Task 0019 found no implemented P0/P1 failures. Treat this as a
fresh-login verification gap, not evidence that current main is broken.

Task 0018 is verified PASS and merged as PR #37. Queue resources
`orun-catalog-ingest` and `orun-catalog-ingest-dlq` were provisioned, Worker
queue bindings are active, and `POST /v1/catalog/sync` returned 202 through the
workers.dev fallback in Task 0018 and Task 0019 smoke runs. Custom-domain
catalog sync from GitHub Actions is blocked by Cloudflare WAF; workers.dev is
the current CI-safe fallback.

Task 0019 verifier report is `ai/reports/task-0019-verifier.md` and its result
is PARTIAL. It verified local backend checks, CI/CD, live Cloudflare queue-backed
catalog ingestion via workers.dev, dashboard build/live HTML, sourceplane/orun
Go tests, and security/data boundaries. Remaining P2 gaps are self-hosted CLI
bootstrap queue provisioning, CLI bootstrap cron configuration, and the embedded
backend bundle missing migration 0006.

Task 0020 verified PASS on 2026-05-08. `sourceplane/orun` PR #87 merged as
squash commit `d8dd132`. The embedded backend bundle includes migration 0006,
`orun backend init/status/destroy` provisions D1/R2/Worker/Queues/DLQ/
consumer/cron, binding-clobber risk from Task 0015 is resolved. Verifier
report: `ai/reports/task-0020-verifier.md`. Local orun main fast-forwarded.

Task 0021 verified PASS on 2026-05-08. PR #39 merged as squash commit `238404e`.
`packages/db` exists as workspace package `@orun/db` with migration harness
(`applyMigrations`, `getMigrationStatus`, `loadMigrations`, `checksumSql`),
`NodePgClient`, CLI scripts, typed domain row types for all 8 core tables,
ID/slug helpers, and `0001_core.sql`. 57 tests pass (no live DB required). All
local and orun CI checks pass (21/21 jobs). Verifier report:
`ai/reports/task-0021-verifier.md`. Live database smoke was not run — Docker/local
Postgres unavailable; deferred to Task 0022 Tactonic provisioning.

Task 0022 prompt is `ai/tasks/task-0022.md`. Per the user's request, it brings
database provisioning forward before V2 API work so DB/schema changes can be
tested as they are developed. The task asks for a Tactonic/Terraform
Supabase/Postgres provisioning scaffold, an on-demand plan-first provisioning
workflow using `SUPABASE_API_KEY`, and a PR-safe real Postgres migration smoke
that runs `pnpm --filter @orun/db migrate` and verifies
`orun_schema_migrations` plus all 8 core tables. Shared Supabase apply must not
run unless account/project/region/secret scope are clear.

The latest architecture update from `scalable-db-conversations.txt` keeps Orun
Cloudflare-first but rejects the long-term "one giant D1" shape. The durable
direction is core D1 for lean control-plane metadata, D1 catalog/run shards for
queryable derived indexes, R2 for raw artifacts and large JSON payloads, Queues
for async ingestion pointer messages, Durable Objects for live coordination, and
Hyperdrive/Postgres only as a later escape hatch for large tenants or analytics.

## Default Read Order

1. `ai/context/current.md`
2. `ai/context/task-ledger.md`
3. `ai/context/decisions.md`
4. `ai/context/open-risks.md`
5. `ai/state.json`
6. Relevant `spec/*.md`
7. Actual source and tests for the area being changed

Do not read the archived historical task/report bundle by default. Open it only
when the compact ledger points at a task that is directly relevant to current
work and the source/specs are insufficient.

## Historical Archive

Verbose historical task prompts and implementer/verifier reports were compressed
on 2026-05-08 to reduce default AI context usage:

```bash
ai/archive/tasks-reports-20260508.tar.gz
```

To inspect the full history without restoring it into the repo surface:

```bash
mkdir -p /tmp/orun-backend-ai-history
tar -xzf ai/archive/tasks-reports-20260508.tar.gz -C /tmp/orun-backend-ai-history
```

New active task prompts should still be written under `ai/tasks/`, and new active
reports should still be written under `ai/reports/`.
