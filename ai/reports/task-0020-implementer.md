# Task 0020 Implementer Report

## Summary

All six required outcomes were implemented in `sourceplane/orun` PR #87. The embedded backend bundle was refreshed to include migration 0006, the Cloudflare client was extended with full queue/consumer/schedule support, and `orun backend init/status/destroy` now provisions and verifies D1/R2/Worker/Queues/DLQ/consumer/cron idempotently. Binding clobber risk from Task 0015 was resolved. All local quality gates pass. Live Cloudflare smoke was not run (credentials not available in implementer environment).

---

## Files Changed

### `sourceplane/orun` — PR #87

| File | Change |
|---|---|
| `internal/backendbundle/embed/migrations/0006_tenant_routes.sql` | New — copied from backend `migrations/0006_tenant_routes.sql` |
| `internal/backendbundle/embed/manifest.json` | Updated backendCommitSHA, added catalogQueueName/DLQName/Cron/ConsumerSettings/Bindings.Queue |
| `internal/backendbundle/bundle.go` | Extended `Manifest` struct with queue/cron/consumer fields; added `ManifestConsumerSettings` type |
| `internal/backendbundle/bundle_test.go` | Added `TestEmbeddedMigrationCount` (≥6), `TestEmbeddedMigrationLatest` (≥0006), `TestManifestLoads` queue/cron assertions |
| `internal/cloudflare/client.go` | New types: `Queue`, `QueueConsumer`, `QueueConsumerSettings`, `WorkerSchedule`; new methods for queues, consumers, schedules; `WorkerBinding.QueueName` and `.Text` fields |
| `internal/cloudflare/client_test.go` | New fake-server tests for all queue/consumer/schedule operations and upload binding verification |
| `internal/cliauth/types.go` | Extended `BackendBootstrap` with CatalogQueueName/ID, CatalogDLQName/ID, CatalogCron |
| `cmd/orun/command_backend.go` | New flags (`--catalog-queue`, `--catalog-dlq`, `--catalog-cron`); full queue/consumer/cron in init/status/destroy |
| `cmd/orun/command_backend_test.go` | New tests: queue/cron in dry-run output, migration count ≥6, JSON fields, destroy dry-run JSON |
| `website/docs/cli/orun-backend.md` | Updated prerequisites (Queues permission), all new flags, destroy order, WAF/workers.dev note, multi-shard D1 note |

---

## Cloudflare API Contracts Verified

All shapes were verified against official Cloudflare documentation before implementation:

| API | Endpoint | Shape |
|---|---|---|
| Queue create | `POST /accounts/{id}/queues` | `{"queue_name": "..."}` → `{queue_id, queue_name}` |
| Queue list | `GET /accounts/{id}/queues` | `→ [{queue_id, queue_name, ...}]` |
| Queue delete | `DELETE /accounts/{id}/queues/{queueID}` | 404 treated as no-op |
| Consumer create | `POST /accounts/{id}/queues/{queueID}/consumers` | `{"type":"worker","script_name":"...","dead_letter_queue":"...","settings":{...}}` |
| Consumer list | `GET /accounts/{id}/queues/{queueID}/consumers` | `→ [{consumer_id, script_name, dead_letter_queue, settings, type}]` |
| Consumer delete | `DELETE /accounts/{id}/queues/{queueID}/consumers/{consumerID}` | 404 treated as no-op |
| Schedule update | `PUT /accounts/{id}/workers/scripts/{name}/schedules` | `[{"cron":"..."}]` — empty array clears all |
| Schedule list | `GET /accounts/{id}/workers/scripts/{name}/schedules` | `→ {schedules: [{cron,...}]}` |
| Worker upload | `PUT /accounts/{id}/workers/scripts/{name}` | Multipart: metadata JSON + `index.js` bundle |
| Queue producer binding | In upload metadata `bindings` array | `{"type":"queue","name":"CATALOG_INGEST_QUEUE","queue_name":"..."}` |
| Plain-text var binding | In upload metadata `bindings` array | `{"type":"plain_text","name":"VAR_NAME","text":"value"}` |

**Binding clobber fix:** Vars are now included as `plain_text` bindings in the single multipart Worker upload call, alongside DO/D1/R2/queue bindings. This eliminates the Task 0015 risk that a separate `PATCH /settings` call with only plain-text bindings could clobber DO/D1/R2/queue bindings. `SetWorkerVars` is retained in the client for other callers but is no longer called by `runBackendInit`.

---

## Checks Run

```
cd /Users/irinelinson/sourceplane/orun

go build ./...
→ exit: 0

go test ./...
→ ok  github.com/sourceplane/orun/cmd/orun           9.128s
→ ok  github.com/sourceplane/orun/internal/backendbundle  4.506s
→ ok  github.com/sourceplane/orun/internal/cliauth    1.572s
→ ok  github.com/sourceplane/orun/internal/cloudflare 4.037s
→ (all 21 packages pass)
→ exit: 0

go test -race ./internal/cloudflare/... ./internal/backendbundle/... ./internal/cliauth/... ./cmd/orun/...
→ ok  github.com/sourceplane/orun/internal/cloudflare  1.654s
→ ok  github.com/sourceplane/orun/internal/backendbundle  2.125s
→ ok  github.com/sourceplane/orun/internal/cliauth    2.699s
→ ok  github.com/sourceplane/orun/cmd/orun            10.188s
→ exit: 0

go vet ./...
→ exit: 0
```

---

## Dry-Run Evidence

### `orun backend init --dry-run`

```
[dry-run] Would provision:
  D1 database:    orun-db
  R2 bucket:      orun-storage
  Worker script:  orun-api
  Migrations:     6
  Catalog queue:  orun-catalog-ingest
  Catalog DLQ:    orun-catalog-ingest-dlq
  Queue consumer: orun-api (batch_size=10, max_retries=3, max_wait_ms=30000, dlq=orun-catalog-ingest-dlq)
  Cron schedule:  */15 * * * *
  Worker vars:    GITHUB_JWKS_URL, GITHUB_OIDC_AUDIENCE
  Worker secrets: ORUN_SESSION_SECRET
  Bundle commit:  faf9e40e83210c66c9aa0934a5f51ffb7a746475
```

### `orun backend init --dry-run --json`

```json
{
  "dryRun": true,
  "workerName": "orun-api",
  "d1DatabaseName": "orun-db",
  "r2BucketName": "orun-storage",
  "catalogQueueName": "orun-catalog-ingest",
  "catalogDLQName": "orun-catalog-ingest-dlq",
  "catalogCron": "*/15 * * * *",
  "migrationsApplied": 0,
  "migrationCount": 6
}
```

### `orun backend destroy --dry-run`

```
[dry-run] Would destroy:
  Worker script:  orun-api
  Cron schedule:  */15 * * * * (cleared)
  Queue consumer: orun-api on orun-catalog-ingest
  Catalog queue:  orun-catalog-ingest
  Catalog DLQ:    orun-catalog-ingest-dlq
  R2 bucket:      orun-storage
  WARNING: D1 and R2 data deletion is irreversible.
```

### `orun backend destroy --dry-run --json`

```json
{
  "dryRun": true,
  "workerDeleted": false,
  "d1Deleted": false,
  "r2Deleted": false,
  "consumerDeleted": false,
  "catalogQueueDeleted": false,
  "catalogDLQDeleted": false,
  "cronCleared": false,
  "workerName": "orun-api",
  "r2BucketName": "orun-storage",
  "catalogQueueName": "orun-catalog-ingest",
  "catalogDLQName": "orun-catalog-ingest-dlq"
}
```

---

## Live Cloudflare Smoke

**Not run.** Cloudflare credentials (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) were not available in the implementer environment. No fake live evidence is presented.

Local fake-server test coverage that substitutes for live smoke:

| Live operation | Local test coverage |
|---|---|
| Queue create idempotent | `TestCreateQueueIdempotent` — verifies POST not called when queue exists |
| Queue create new | `TestCreateQueueNew` — verifies POST called for absent queue |
| Queue delete missing → no error | `TestDeleteQueueByNameMissing`, `TestDeleteQueueByIDMissing` |
| Consumer create new | `TestCreateQueueConsumerNew` |
| Consumer idempotent (settings match) | `TestCreateQueueConsumerIdempotent` |
| Consumer replace on settings mismatch | `TestCreateQueueConsumerReplacesOnSettingsMismatch` |
| Consumer delete missing → no error | `TestDeleteQueueConsumerMissing` |
| Schedule update PUT body shape | `TestUpdateWorkerSchedules` |
| Schedule clear sends empty array | `TestDeleteWorkerSchedulesClearsAll` |
| Queue binding in upload metadata | `TestUploadWorkerIncludesQueueBinding` |
| DO/D1/R2/queue/plain_text all in single upload | `TestUploadWorkerIncludesQueueBinding` (verifies all 5 binding types present) |
| Init dry-run shows 6 migrations | `TestBackendInitDryRunMigrationCount` |
| Init dry-run JSON has migrationCount ≥ 6 | `TestBackendInitDryRunJSON` |
| Init dry-run shows queue/DLQ/cron | `TestBackendInitDryRun` |
| Destroy dry-run shows queue/DLQ | `TestBackendDestroyDryRun` |
| Destroy dry-run JSON has catalogQueueName/DLQName | `TestBackendDestroyDryRunJSON` |
| Status JSON has queue/consumer/cron fields | `TestBackendStatusJSON` |

---

## Endpoint Smoke

Not run (no Cloudflare live credentials; would require a deployed Worker). Basic unauthenticated endpoint behavior was verified in Task 0018 and Task 0019 smoke runs and remains unchanged.

---

## Fresh Local Remote-State Smoke

Not run. The implementer CLI session predates Task 0012.2.1 and lacks the `githubUserId` claim required for `orun cloud link`. This is the same verification gap noted in Task 0019. The fix requires a fresh `orun auth login` session.

---

## Assumptions

1. **Queue consumer settings:** `batch_size=10`, `max_retries=3`, `max_wait_time_ms=30000`, `dead_letter_queue=<dlq-name>` are hardcoded as the defaults matching production Task 0018 settings. Self-hosted users wanting different settings must re-run `orun backend init` with a modified `--catalog-queue` consumer attachment; adding per-flag overrides for consumer settings is deferred as a future enhancement.

2. **SetWorkerVars retained:** The `SetWorkerVars` method is kept in the Cloudflare client for potential future callers (e.g., re-setting vars after upload without re-uploading the bundle), but is no longer called by `runBackendInit`. The PATCH behavior risk is documented.

3. **Cron schedule:** `UpdateWorkerSchedules` sends an array with exactly the managed cron (e.g., `["*/15 * * * *"]`), replacing any previously set schedules. This is idempotent for the typical case of a single managed cron, but would overwrite any additional manually added crons. Documented in the implementation.

4. **Cloudflare schedule GET shape:** The `GET /schedules` response wraps schedules in `{schedules: [...]}` per the API docs. `ListWorkerSchedules` unwraps this correctly.

5. **Destroy without catalogQueueID:** If `meta.CatalogQueueID` is empty (e.g., from an older bootstrap that predates queue metadata), the destroy consumer step is skipped gracefully. Queue deletion still proceeds via `DeleteQueueByName`.

---

## Spec Proposals

None opened. The queue/consumer/cron addition to CLI bootstrap is a pure implementation task within the existing spec. The multi-shard D1 catalog blocker (`ai/proposals/task-0016-spec-update.md`) remains open and unrelated to this task.

---

## Remaining Gaps

- **Live Cloudflare smoke not run** — no credentials in implementer env. Verifier should run disposable smoke if credentials are available.
- **Consumer settings flags** — `batch_size`, `max_retries`, `max_wait_time_ms` are not configurable via CLI flags; defaults match production Task 0018 values. This is acceptable for self-hosted use but limits customization.
- **Single managed cron** — `UpdateWorkerSchedules` replaces all schedules with the one managed cron. If users have additional manual crons, they will be cleared. A future enhancement could merge rather than replace.
- **Task 0012 yellow bookkeeping** — still requires a fresh `orun auth login` session with `githubUserId` claim. Unchanged from Task 0019 PARTIAL result.
- **WAF custom domain** — `POST /v1/catalog/sync` via custom domain blocked from GHA IPs; documented in docs to use `workers.dev` fallback.

---

## Next Task Dependencies

- Verifier for PR #87 should run local checks and disposable Cloudflare live smoke if credentials are available.
- After PASS: repo health can advance; Task 0012 yellow bookkeeping remains open separately.
- Multi-shard D1 activation still blocked by `ai/proposals/task-0016-spec-update.md`.

---

## PR Number

**sourceplane/orun PR #87** — `feat: task-0020 CLI bootstrap queue provisioning and embedded bundle refresh`
Branch: `task-0020-cli-bootstrap-queue-provisioning`
Head commit: `07a3c21`
