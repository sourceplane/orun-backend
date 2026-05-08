# Task 0020 Verifier Report

## Result

PASS

## Summary

PR #87 (`feat: task-0020 CLI bootstrap queue provisioning and embedded bundle refresh`) satisfies all Task 0020 acceptance criteria. All local Go checks and dry-run smokes pass. CI logs are clean. Cloudflare API shapes are correct by documentation and comprehensive fake-server test coverage. The Task 0015 Worker binding-clobber risk is resolved. No P0/P1/P2 blockers found. Live Cloudflare smoke was not run due to unavailable credentials — recorded as residual risk.

---

## PR Reviewed

- **Repo:** sourceplane/orun
- **PR:** #87 — `feat: task-0020 CLI bootstrap queue provisioning and embedded bundle refresh`
- **Branch:** `task-0020-cli-bootstrap-queue-provisioning`
- **Head commit:** `07a3c2190513e242f808ba5d13f6b359f0c55b9c`
- **Base:** `main`
- **Merge state:** CLEAN

### Scope and Diff Review

Files touched:

| File | Purpose |
|---|---|
| `internal/backendbundle/embed/migrations/0006_tenant_routes.sql` | New migration embedded |
| `internal/backendbundle/embed/manifest.json` | Updated SHA, added queue/cron metadata |
| `internal/backendbundle/bundle.go` | Extended Manifest struct with queue/cron/consumer fields |
| `internal/backendbundle/bundle_test.go` | New tests: migration count ≥6, latest ≥0006, manifest queue/cron assertions |
| `internal/cloudflare/client.go` | New Queue/Consumer/Schedule types and methods |
| `internal/cloudflare/client_test.go` | New fake-server tests for all new operations |
| `internal/cliauth/types.go` | Extended BackendBootstrap with CatalogQueueName/ID/DLQName/ID/Cron |
| `cmd/orun/command_backend.go` | New flags; full queue/consumer/cron in init/status/destroy |
| `cmd/orun/command_backend_test.go` | New tests covering dry-run queue/cron/migration count |
| `website/docs/cli/orun-backend.md` | Updated prerequisites, new flags, destroy order, WAF note, multi-shard note |

**Scope constraints confirmed:**
- No `DB_CATALOG_0` or `DB_CATALOG_1` bindings activated.
- No Hyperdrive, Postgres, Supabase, or V2 runtime API behavior.
- No secrets, tokens, or live credentials in fixtures or config.
- Changes are strictly bounded to self-hosted bootstrap, Cloudflare client, embedded artifacts, docs, and tests.

---

## Checks Run

All local checks run fresh (no cache, `-count=1`):

```
cd /Users/irinelinson/sourceplane/orun

go test -count=1 ./...
→ all 21 packages: ok (no failures)

go test -count=1 -race ./internal/cloudflare/... ./internal/backendbundle/... ./internal/cliauth/... ./cmd/orun/...
→ ok  internal/cloudflare   2.541s
→ ok  internal/backendbundle  3.968s
→ ok  internal/cliauth    1.962s
→ ok  cmd/orun            12.218s

go vet ./...
→ exit: 0
```

### Dry-Run Smokes

**`orun backend init --dry-run`:**
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

6 migrations, queue, DLQ, consumer, cron — all present. No secrets printed. ✅

**`orun backend init --dry-run --json`:**
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

`migrationCount=6`, `catalogQueueName`, `catalogDLQName`, `catalogCron` all present. ✅

**`orun backend destroy --dry-run`:**
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

Consumer/cron/queue/DLQ all listed. ✅

**`orun backend destroy --dry-run --json`:**
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

All queue/DLQ/consumer/cron fields present. ✅

---

## CI Logs Reviewed

| Check | Workflow | Conclusion | Notes |
|---|---|---|---|
| Orun Plan | CI | SUCCESS | orun plan ran; plan artifact uploaded |
| Harness dry-run guard | orun remote-state conformance | SUCCESS | All [guard] PASS |
| matrix.job-name | CI | SKIPPED | Expected: workflow guard for matrix |
| Compile plan | orun remote-state conformance | SKIPPED | Expected: no ORUN_TOKEN on PR branch |
| Run: ${{ matrix.job }} | orun remote-state conformance | SKIPPED | Expected: same |
| Env fanout: ${{ matrix.env_name }} | orun remote-state conformance | SKIPPED | Expected: same |
| Verify remote status and logs | orun remote-state conformance | SKIPPED | Expected: same |

All skips are expected workflow guards for remote-state conformance jobs that require ORUN_TOKEN and a live backend. No hidden failures. Harness dry-run guard shows all 20+ individual guard checks PASS. ✅

---

## Cloudflare API Shape Review

All shapes verified against official Cloudflare documentation and confirmed correct by fake-server test coverage:

| API | Shape | Verdict |
|---|---|---|
| Queue create `POST /accounts/{id}/queues` | `{"queue_name":"..."}` → `{queue_id, queue_name}` | ✅ correct |
| Queue list `GET /accounts/{id}/queues` | `→ [{queue_id, queue_name, ...}]` | ✅ correct |
| Queue delete `DELETE /accounts/{id}/queues/{queueID}` | 404 treated as no-op | ✅ correct |
| Consumer create `POST /accounts/{id}/queues/{queueID}/consumers` | `{"type":"worker","script_name":"...","dead_letter_queue":"...","settings":{...}}` | ✅ correct |
| Consumer list `GET /accounts/{id}/queues/{queueID}/consumers` | `→ [{consumer_id, script_name, dead_letter_queue, type, settings}]` | ✅ correct |
| Consumer delete `DELETE /accounts/{id}/queues/{queueID}/consumers/{consumerID}` | 404 no-op | ✅ correct |
| Schedule update `PUT /accounts/{id}/workers/scripts/{name}/schedules` | `[{"cron":"..."}]` — empty clears all | ✅ correct |
| Schedule list `GET /accounts/{id}/workers/scripts/{name}/schedules` | `{schedules:[...]}` unwrapped correctly via inner struct | ✅ correct |
| Worker upload multipart | `main_module: "index.js"` (not `body_part`) | ✅ correct (Task 0015 fix retained) |
| Queue producer binding in upload metadata | `{"type":"queue","name":"CATALOG_INGEST_QUEUE","queue_name":"..."}` | ✅ correct |
| Plain-text var binding | `{"type":"plain_text","name":"...","text":"..."}` | ✅ correct |

**Binding clobber fix (Task 0015 residual):** Confirmed resolved. `runBackendInit` sends all bindings (DO × 2, D1, R2, queue producer, plain-text vars) in the single multipart Worker upload call. `SetWorkerVars` is retained in the client but is **not called** by `runBackendInit`. This correctly eliminates the PATCH `/settings` clobbering risk.

---

## Live Cloudflare Smoke

**Not run.** `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` not set in the verifier environment.

Local fake-server coverage confirmed for all live operations (see implementer report for mapping). This is an acceptable residual risk per Task 0020 verifier constraints — the production Cloudflare resources from Task 0018 remain confirmed live from that task's smoke run.

---

## Fresh Local Remote-State Smoke

Not run. Same gap as Task 0019 PARTIAL — the available CLI session predates Task 0012.2.1 and lacks the `githubUserId` claim. This is unchanged from the prior yellow bookkeeping note and is not introduced by Task 0020.

---

## Issues

None. No P0/P1/P2 blockers found.

---

## Risk Notes

| Risk | Severity | Status |
|---|---|---|
| Live Cloudflare smoke not run in verifier or implementer environment | Residual | Acceptable per constraints; production CF resources confirmed from Task 0018 |
| `UpdateWorkerSchedules` replaces all schedules (would overwrite manually added crons) | Low | Documented in implementer report and code |
| Consumer settings not configurable via CLI flags | Low | Deferred by design; defaults match production Task 0018 settings |
| Task 0012 yellow bookkeeping (fresh login gap) | Yellow | Unchanged; requires post-Task-0012.2.1 `orun auth login` |
| WAF blocking custom domain catalog sync from GHA IPs | Yellow | Documented in docs; workers.dev fallback is the CI-safe path |

---

## Spec Proposals

None opened by implementer or verifier. No new user-visible contract changes requiring a proposal.

---

## Recommended Next Move

**Task 0021:** Create `packages/db` and the first V2 Supabase/Postgres migration harness per `spec/v2/07-provisioning-and-operations.md`.

PR #87 is merged. Local `sourceplane/orun` main is fast-forwarded. Repo health remains yellow only for the pre-existing Task 0012 fresh-login bookkeeping gap, which is unrelated to Task 0020.
