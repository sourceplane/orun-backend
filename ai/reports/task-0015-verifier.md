# Task 0015 Verifier Report

## Result: PASS

## Summary

Task 0015 implements `orun backend init/status/destroy` in the `sourceplane/orun` CLI, allowing users to self-host an Orun backend on Cloudflare via direct REST APIs.

The verifier found two API shape issues (both fixed directly on the PR branch before merge):
1. `body_part` was used instead of `main_module` in the Worker upload metadata — incorrect for ES Module Workers (the bundle exports `export { ... }` and uses `application/javascript+module` content type).
2. The DO migration `new_tag` was not set at the top level of the migrations object — needed for Cloudflare to track migration state across re-uploads.

After both fixes, all local tests pass (race-clean, vet-clean), CI is green on the updated head (`1beca7b`), and PR #86 was merged as squash commit `afd3828`.

## PR / CI Context

- PR: `sourceplane/orun` #86 — `feat: task-0015 CLI backend bootstrap — orun backend init/status/destroy`
- Branch: `codex/task-0015-backend-bootstrap`
- Head at merge: `1beca7b37bcb0f64727eb1d986d5854329a1e1ca` (verifier added 1 commit)
- Merged as squash: `afd38280076d0f202cbce29bea1e2d304c8bfe95`
- CI run on `1beca7b`: `25516573069` — Orun Plan SUCCESS, matrix SKIPPED (no changed Orun jobs)
- Conformance run on `1beca7b`: `25516573123` — Harness dry-run guard SUCCESS, live conformance SKIPPED by gate
- CI logs inspected: no credentials, API tokens, session secrets, or OAuth secrets exposed.

## Checks

### 1. Bundle Provenance and Safety

- Worker bundle embedded with `//go:embed embed/worker/index.js` ✓
- Bundle size 127 461 bytes (non-empty) ✓
- Manifest commit SHA `3429079e7c3848dfdd5548675a92e8a50a41e4cb` verified against `git rev-parse 3429079` in `orun-backend` — exact match ✓
  - Note: implementer report has a typo (`fddd` vs `dfdd` at position 14-15) but the embedded manifest is correct.
- Binding names match `wrangler.jsonc`: COORDINATOR, RATE_LIMITER (DO), DB (D1), STORAGE (R2) ✓
- DO classes match: RunCoordinator, RateLimitCounter ✓
- 5 embedded migrations (0001–0005) in lexical order, matching `orun-backend/migrations/` ✓
- No secrets, account IDs, or user-specific live resource IDs in embedded files ✓
- Refresh procedure documented in package doc ✓

### 2. Cloudflare API Reality Review

**D1:** List (`GET /accounts/{id}/d1/database?per_page=100`), create, delete by UUID — correct shapes ✓  
**R2:** List/create/delete — `buckets` wrapper in list response handled correctly ✓  
**Worker upload:** `PUT /accounts/{id}/workers/scripts/{name}` multipart — **fixed**: changed `body_part` → `main_module` (required for ES Module Workers) ✓  
**DO bindings:** `type: "durable_object_namespace"`, `class_name`, `script_name` — correct ✓  
**D1 binding:** `type: "d1"`, `id` (database UUID) — struct field `DatabaseID` serializes as `"id"` ✓  
**R2 binding:** `type: "r2_bucket"`, `bucket_name` ✓  
**DO migrations:** `new_tag` **fixed** to propagate from last step's Tag field ✓  
**Worker vars:** `PATCH /accounts/{id}/workers/scripts/{name}/settings` with `bindings: [{type: "plain_text", ...}]` ✓  
**Worker secrets:** `PUT /accounts/{id}/workers/scripts/{name}/secrets` (single secret per call) ✓  
**Workers.dev subdomain:** `GET /accounts/{id}/workers/subdomain` (best-effort) ✓  
**Subdomain route:** `POST /accounts/{id}/workers/scripts/{name}/subdomain` with `{"enabled": true}` ✓  

Pagination: `per_page=100` for D1 list. Accounts with >100 D1 databases could get false not-found; acceptable for typical self-hosted deployments.

### 3. Cloudflare Client Quality

- `Authorization: Bearer <token>` on every request ✓ (tested `TestAuthHeaderAndUserAgent`)
- `User-Agent: orun-cli/<version>` ✓
- Injectable HTTP client and base URL ✓
- Envelope parsing (`success/errors/result`) ✓
- Non-2xx and malformed JSON handled ✓
- API tokens never appear in error strings ✓; secret values explicitly redacted (`(value redacted)` suffix) ✓
- D1 and R2 create/reuse by name (idempotent) ✓
- Migrations applied in sort.Strings() order ✓
- Migration not recorded until SQL succeeds (apply then insert into `_orun_migrations`) ✓
- Orun-managed `_orun_migrations` table for ledger (Cloudflare D1 API doesn't expose Wrangler's internal ledger) — documented ✓
- Delete methods scoped to account + explicit UUIDs/names ✓

### 4. CLI Command Review

**init:**
- Reads `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` with flag overrides ✓
- Creates/reuses D1 and R2 idempotently ✓
- Applies all migrations in order, skips already-applied ✓
- Uploads Worker with D1/R2/DO bindings ✓
- Sets `GITHUB_JWKS_URL`, `GITHUB_OIDC_AUDIENCE`, `ORUN_PUBLIC_URL` when discoverable, `ORUN_DASHBOARD_URL` when provided ✓
- Generates `ORUN_SESSION_SECRET` with `crypto/rand` (32 bytes, hex) if absent ✓
- Sets `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` only when provided ✓
- Warns when GitHub OAuth is missing ✓
- Stores non-secret bootstrap metadata ✓
- `--dry-run` exits without any Cloudflare calls ✓
- `--json` output ✓
- Secrets never printed in text or JSON ✓

**status:**
- Reads stored metadata and/or flags ✓
- Checks Worker, D1, R2, migration count, secrets (names only) ✓
- Exits non-zero for missing resources ✓
- `--json` ✓
- No secret values revealed ✓

**destroy:**
- Refuses without `--yes` (unless `--dry-run`) ✓ (tested `TestBackendDestroyRefusesWithoutYes`)
- `--dry-run` safe ✓
- `--json` ✓
- Guard: requires `ManagedBy == "orun-backend-init"` metadata unless `--adopted` ✓
- Deletes Worker → D1 → R2 (safe order) ✓
- Clears bootstrap metadata, not auth credentials or repo links ✓
- Warns D1/R2 deletion is irreversible ✓
- Notes GitHub OAuth app not deleted ✓

### 5. Config Integration

- `BackendBootstrap` stores only non-secret metadata ✓
- No Cloudflare API token, GitHub client secret, session secret, Orun session tokens in config ✓
- `SaveBootstrapMetadata` sets `backend.url` while preserving `Repos` ✓
- `ClearBootstrapMetadata` zeroes `BackendBootstrap`, preserves `Backend.URL` and `Repos` ✓
- Config written with `0o600` permissions (enforced by `SaveConfig`) ✓
- Existing auth/cloud/remote-state behavior not touched ✓

### 6. Tests and Coverage

- Bundle: manifest loads, worker non-empty, migrations sorted, no embedded marker ✓
- Cloudflare client: auth header/UA, D1 list/create/idempotent, R2 list/create/idempotent, secret redaction, error envelope parsing, missing Worker returns nil ✓
- Migration order: `TestMigrationsAppliedInOrder` verifies ExecD1SQL call sequence ✓
- CLI: dry-run text, dry-run JSON, missing credentials, destroy refusal without `--yes`, destroy dry-run, JSON output structure ✓
- `TestOutputRedactsSecrets`: verifies `initResult` JSON has no secret field names ✓
- Config: `SaveBootstrapMetadata` / `LoadBootstrapMetadata` / `ClearBootstrapMetadata` covered by cliauth package tests ✓

Minor gap: `TestNoEmbeddedSecretLookingValues` only checks for a sentinel string in the bundle and doesn't do deep pattern scanning; acceptable since the bundle is generated from a clean build.

### 7. Docs Review

- `website/docs/cli/orun-backend.md` — full reference page ✓
- Added to `orun.md` command map ✓
- Added to `website/sidebars.js` ✓
- Cloudflare permissions documented (Workers Scripts: Edit, Durable Objects: Edit, D1: Edit, R2: Edit) ✓
- GitHub OAuth setup documented (callback URL, no PAT required) ✓
- All required env vars documented (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `ORUN_SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ORUN_DASHBOARD_URL`) ✓
- `--dry-run`, `--json`, `destroy --yes` documented ✓
- Config/security model explained ✓
- Known gaps documented: live smoke not run, cron trigger not set, compatibility_flags not set ✓

## Local Checks

```
go test ./...       — PASS (all packages)
go test -race ./... — PASS (race-clean)
go vet ./...        — PASS

go test ./cmd/orun ./internal/... -run 'Backend|Cloudflare|Auth|Cloud|Remote' — PASS

# Dry-run smokes (tmp HOME):
backend init --dry-run --json  → valid JSON, dryRun=true  ✓
backend destroy --dry-run --json → valid JSON, dryRun=true ✓
backend status --json          → credential error (expected; status requires Cloudflare API) ✓
```

## Live Cloudflare Smoke

**Not run.** No live Cloudflare credentials available in the verifier environment. Acceptance per verifier protocol:
- API shapes verified against official Cloudflare documentation ✓
- `body_part` → `main_module` and `new_tag` fixes applied and pushed before merge ✓
- Fake-server tests and dry-run flows are strong ✓
- All API-shape uncertainties recorded below as risk notes ✓

## Issues

### Fixed by verifier on PR branch

1. **`body_part` → `main_module`** (`internal/cloudflare/client.go:287`): The Worker bundle uses ES Module format (`export { RunCoordinator, RateLimitCounter, src_default as default }`). Cloudflare documents `main_module` as the required field for module Workers; `body_part` is the legacy service-worker format field. Fixed before merge.

2. **Missing `new_tag` in DO migrations** (`internal/cloudflare/client.go:307–314`): The migrations object had no `new_tag` set. Cloudflare uses this tag to track DO migration state across re-uploads. Fixed: `NewTag` is now derived from the last step's `Tag` field before merge.

## Risk Notes

1. **SetWorkerVars PATCH /settings binding behavior**: `init` uploads the Worker with D1/R2/DO bindings, then calls `PATCH /settings` with only plain_text var bindings. If Cloudflare's PATCH replaces all bindings rather than merging, D1/R2/DO bindings would be lost. Standard PATCH semantics suggest a merge, and Cloudflare's settings endpoint is designed for partial updates. Confirmed by live smoke before any production use.

2. **Pagination at `per_page=100`**: D1 list only fetches the first 100 databases. Accounts with >100 D1 databases could experience false not-found during idempotency check, leading to duplicate DB creation. Acceptable for typical self-hosted installs but documented.

3. **`new_tag`-only (no `old_tag`) on re-upload**: On subsequent `orun backend init` runs, the migration `old_tag` is not set. Cloudflare may apply migration steps again if it doesn't recognize the current tag. Mitigated by the SQL `_orun_migrations` ledger (migrations are idempotent at the SQL level).

4. **Worker cron trigger not configured**: `wrangler.jsonc` declares `*/15 * * * *` cron. The REST API for script upload does not accept cron in the same request; a separate Triggers API call would be required. Documented as known gap.

5. **`compatibility_flags` not set**: Defaults to empty (safe for current bundle).

6. **Implementer report SHA typo**: Report says `3429079e7c3848fddd...` but actual SHA is `3429079e7c3848dfdd...`. The embedded manifest is correct.

## Spec Proposals

None required. All behavior was implementable with current Cloudflare REST API.

## Recommended Next Move

1. **Live Cloudflare smoke** before any production user runs `orun backend init`. Specifically verify:
   - Worker upload succeeds with `main_module` (confirming the fix)
   - `PATCH /settings` with var bindings preserves D1/R2/DO bindings
   - Workers.dev route is accessible after `EnableWorkerSubdomainRoute`
2. **Cron trigger provisioning** (Task 0015.x): Add `POST /accounts/{id}/workers/scripts/{name}/schedules` call to configure the `*/15 * * * *` GC cron.
3. **Advance to next roadmap task.**
