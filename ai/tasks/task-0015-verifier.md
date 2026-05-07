# Task 0015 Verifier

# Agent

Verifier

# Current Repo Context

Task 0015 implements self-hosted Orun backend bootstrap in the `sourceplane/orun` CLI.

Primary implementation repo:

```text
/Users/irinelinson/sourceplane/orun
```

Planning/reporting repo:

```text
/Users/irinelinson/sourceplane/orun-backend
```

PR to verify:

- Repo: `sourceplane/orun`
- PR: #86
- URL: `https://github.com/sourceplane/orun/pull/86`
- Title: `feat: task-0015 CLI backend bootstrap — orun backend init/status/destroy`
- Branch: `codex/task-0015-backend-bootstrap`
- Base: `main`
- Head at verifier prompt creation: `e7331c2d6824d8544ef358926ea6a9fcce035da1`
- State at verifier prompt creation: open, not draft
- Merge state at verifier prompt creation: `CLEAN`

CI at verifier prompt creation:

- CI run: `25515271707`
  - URL: `https://github.com/sourceplane/orun/actions/runs/25515271707`
  - Event: `pull_request`
  - Head SHA: `e7331c2d6824d8544ef358926ea6a9fcce035da1`
  - Result: success
  - Jobs:
    - `Orun Plan` success
    - matrix execution skipped because `orun plan --changed` produced no execution jobs
- Remote-state conformance run: `25515271690`
  - URL: `https://github.com/sourceplane/orun/actions/runs/25515271690`
  - Event: `pull_request`
  - Head SHA: `e7331c2d6824d8544ef358926ea6a9fcce035da1`
  - Result: success
  - Jobs:
    - `Harness dry-run guard` success
    - live conformance jobs skipped by gate

Implementation report:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0015-implementer.md
```

Important local bookkeeping state at verifier prompt creation:

- `sourceplane/orun` local checkout is on `codex/task-0015-backend-bootstrap` at `e7331c2`, aligned with `origin/codex/task-0015-backend-bootstrap`.
- `sourceplane/orun-backend` local checkout is `main`, ahead of `origin/main` by one commit: `68af80b chore: task-0015 implementer report and state update`.
- `sourceplane/orun-backend/ai/tasks/task-0015.md` is untracked. Do not delete it. If PASS, include it in verifier/bookkeeping as appropriate.
- `sourceplane/orun-backend` state currently has `next_focus: "task-0015-verifier"` and notes that PR #86 is ready for verification.

# Objective

Verify that PR #86 safely implements the first production-grade `orun backend` self-hosting bootstrap slice:

```bash
orun backend init
orun backend status
orun backend destroy
```

The verifier must be security-first and API-reality-first. Do not pass only because fake-server tests are green. Inspect Cloudflare REST API assumptions against current official Cloudflare docs, review secret handling and destructive safeguards, run local checks, inspect CI logs, and decide whether the known lack of live Cloudflare smoke is acceptable for this slice.

# Read First

In `orun-backend`:

1. `/Users/irinelinson/sourceplane/orun-backend/agents/orchestrator.md`
2. `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0015.md`
3. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0015-implementer.md`
4. `/Users/irinelinson/sourceplane/orun-backend/spec/00-constitution.md`
5. `/Users/irinelinson/sourceplane/orun-backend/spec/01-monorepo-structure.md`
6. `/Users/irinelinson/sourceplane/orun-backend/spec/02-devops.md`
7. `/Users/irinelinson/sourceplane/orun-backend/spec/04-worker-api.md`
8. `/Users/irinelinson/sourceplane/orun-backend/spec/06-auth.md`
9. `/Users/irinelinson/sourceplane/orun-backend/spec/07-storage.md`
10. `/Users/irinelinson/sourceplane/orun-backend/apps/worker/wrangler.jsonc`
11. `/Users/irinelinson/sourceplane/orun-backend/migrations/*.sql`

In `sourceplane/orun`:

1. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_backend.go`
2. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_backend_test.go`
3. `/Users/irinelinson/sourceplane/orun/cmd/orun/commands_root.go`
4. `/Users/irinelinson/sourceplane/orun/internal/backendbundle/bundle.go`
5. `/Users/irinelinson/sourceplane/orun/internal/backendbundle/bundle_test.go`
6. `/Users/irinelinson/sourceplane/orun/internal/backendbundle/embed/manifest.json`
7. `/Users/irinelinson/sourceplane/orun/internal/backendbundle/embed/migrations/*.sql`
8. `/Users/irinelinson/sourceplane/orun/internal/backendbundle/embed/worker/index.js`
9. `/Users/irinelinson/sourceplane/orun/internal/cloudflare/client.go`
10. `/Users/irinelinson/sourceplane/orun/internal/cloudflare/client_test.go`
11. `/Users/irinelinson/sourceplane/orun/internal/cliauth/storage.go`
12. `/Users/irinelinson/sourceplane/orun/internal/cliauth/types.go`
13. `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun-backend.md`
14. `/Users/irinelinson/sourceplane/orun/website/docs/reference/environment-variables.md`

# PR, CI, and Diff Inspection

Inspect PR metadata and diff:

```bash
gh pr view 86 --repo sourceplane/orun --json number,title,url,state,isDraft,headRefName,headRefOid,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,commits,files,updatedAt
gh pr diff 86 --repo sourceplane/orun --name-only
gh pr diff 86 --repo sourceplane/orun --patch
git diff --stat main...HEAD
git diff --name-status main...HEAD
```

Inspect CI logs:

```bash
gh run view 25515271707 --repo sourceplane/orun --log
gh run view 25515271690 --repo sourceplane/orun --log
```

Verify:

- PR head still matches `e7331c2d6824d8544ef358926ea6a9fcce035da1`, or inspect newer commits before continuing.
- PR is open, not draft, and merge state is clean.
- Current PR checks are green on the current head.
- CI logs are understood, including the fact that the main Orun CI did not execute a changed job matrix.
- Logs do not expose Cloudflare API tokens, GitHub OAuth secrets, Orun session tokens, generated session secrets, or other credentials.
- CI coverage is not overstated. The verifier must run local Go tests/race/vet because CI is not sufficient for the new bootstrap code.

# Required Verification Work

## 1. Bundle Provenance and Safety

Verify `internal/backendbundle`:

- Worker bundle is embedded with `//go:embed`.
- Bundle is non-empty and plausibly matches `orun-backend/apps/worker/dist/index.js` from commit `3429079e7c3848fddd5548675a92e8a50a41e4cb`.
- Manifest commit SHA is exact. Watch for typo drift between report and manifest.
- Manifest date/version and default resource names are present.
- Binding names match `orun-backend/apps/worker/wrangler.jsonc`:
  - Durable Objects: `COORDINATOR`, `RATE_LIMITER`
  - D1: `DB`
  - R2: `STORAGE`
- Durable Object classes match backend bundle exports:
  - `RunCoordinator`
  - `RateLimitCounter`
- Embedded migrations exactly match the backend migrations in meaning and ordering.
- Migrations are returned in deterministic lexical order.
- Embedded files contain no secret-looking values, tokens, account IDs, or user-specific live resource IDs.
- Refresh procedure is documented.

FAIL if the embedded bundle is stale, unverifiable, missing migrations, or contains secrets.

## 2. Cloudflare API Reality Review

Verify the Cloudflare REST client against current official Cloudflare API docs.

Review, at minimum:

- D1 list/create/delete database endpoints.
- D1 SQL query endpoint and response shape.
- R2 bucket list/create/delete endpoints.
- Worker module script upload endpoint and required multipart metadata/module shape.
- Worker bindings shape for D1, R2, and Durable Objects.
- Worker settings/vars endpoint shape.
- Worker secrets endpoint shape.
- Worker script status/get/delete endpoint behavior.
- workers.dev subdomain discovery and script subdomain route behavior.

The implementer report claims these endpoints:

```text
GET    /accounts/{id}/d1/database
POST   /accounts/{id}/d1/database
DELETE /accounts/{id}/d1/database/{uuid}
POST   /accounts/{id}/d1/database/{uuid}/query
GET    /accounts/{id}/r2/buckets
POST   /accounts/{id}/r2/buckets
DELETE /accounts/{id}/r2/buckets/{name}
GET    /accounts/{id}/workers/scripts/{name}
PUT    /accounts/{id}/workers/scripts/{name}
DELETE /accounts/{id}/workers/scripts/{name}
PATCH  /accounts/{id}/workers/scripts/{name}/settings
PUT    /accounts/{id}/workers/scripts/{name}/secrets
GET    /accounts/{id}/workers/scripts/{name}/secrets
GET    /accounts/{id}/workers/subdomain
POST   /accounts/{id}/workers/scripts/{name}/subdomain
```

Confirm whether the implementation's request bodies and response parsing match docs, not only endpoint paths.

If a Cloudflare API shape is likely wrong but fake tests mask it, FAIL or require a proposal/remediation before merge. The most important area is Worker module upload metadata/bindings, because fake-server success alone does not prove live deployability.

## 3. Cloudflare Client Quality Review

Verify `internal/cloudflare/client.go`:

- Uses `Authorization: Bearer <token>` for every API request.
- Sets `User-Agent`.
- Has injectable base URL / HTTP client for tests.
- Parses Cloudflare success/error envelopes safely.
- Handles non-2xx and malformed JSON with actionable errors.
- Does not include API tokens or secret values in errors.
- Idempotently creates/reuses D1 and R2 resources by name.
- Applies migrations in deterministic order.
- Does not mark a migration applied unless the migration SQL succeeded.
- Uses an Orun-managed migration ledger only if Cloudflare/Wrangler migration ledger is unavailable, and documents that choice.
- Worker upload includes all required bindings and module metadata.
- Vars and secrets are set through appropriate endpoints without leaking values.
- Status checks distinguish missing, present, and unknown states.
- Delete methods are scoped to the configured account and explicit resource IDs/names.

Pay special attention to pagination. If list endpoints only fetch `per_page=100`, note risk if accounts have more resources; fail only if it makes common idempotency unsafe or silently creates duplicates.

## 4. CLI Command Review

Verify `cmd/orun/command_backend.go`:

`orun backend init`:

- Reads `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, with flag overrides.
- Creates/reuses D1 and R2.
- Applies all bundled migrations once and in order.
- Uploads Worker script with D1/R2/DO bindings.
- Sets `GITHUB_JWKS_URL`, `GITHUB_OIDC_AUDIENCE`, `ORUN_PUBLIC_URL` when known/provided, and `ORUN_DASHBOARD_URL` when provided.
- Generates `ORUN_SESSION_SECRET` with cryptographic randomness if absent.
- Sets `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` only when provided.
- Warns when GitHub OAuth config is missing.
- Stores non-secret bootstrap metadata and default backend URL.
- Supports `--dry-run` with no Cloudflare calls.
- Supports `--json`.
- Never prints secrets in text or JSON output.

`orun backend status`:

- Reads stored metadata and/or flags.
- Checks Worker, D1, R2, migration readiness, vars/secrets readiness, and backend URL.
- Exits non-zero for missing required resources.
- Supports `--json`.
- Does not require write/destructive operations.
- Does not expose secret values.

`orun backend destroy`:

- Refuses without `--yes` unless genuinely interactive confirmation is implemented and tested.
- Supports `--dry-run`.
- Supports `--json`.
- Uses managed-resource metadata by default.
- Requires explicit override for adopted/unmanaged resources.
- Deletes in a safe order and clears only bootstrap metadata, not auth credentials or repo links.
- Warns that D1/R2 deletion is irreversible.

FAIL for accidental destructive-by-name behavior, token/secret printing, or config clobbering.

## 5. Config Integration Review

Verify `internal/cliauth` changes:

- Stores only non-secret bootstrap metadata.
- Does not store Cloudflare API token, GitHub client secret, session secret, Orun access token, or refresh token in `config.yaml`.
- Preserves existing backend URL and repo links unless intentionally updating `backend.url` after successful init.
- Config file remains `0600`.
- `ClearBootstrapMetadata` does not clear CLI auth credentials or repo links.
- Existing auth/cloud/remote-state behavior remains compatible.

Run or inspect existing tests around config/auth/cloud remote-state behavior.

## 6. Tests and Coverage Review

Verify tests cover the required task outcomes:

- Bundle manifest, non-empty worker, sorted migrations, no secret-looking embedded values.
- Cloudflare auth header / user agent.
- D1 list/create/reuse/delete and query execution.
- Migration ledger ordering and failure behavior.
- R2 list/create/reuse/delete.
- Worker upload metadata/bindings.
- Vars/secrets without leaking values.
- Status checks.
- Destroy delete endpoints and managed-resource safeguards.
- CLI `init --dry-run`, `init --json --dry-run`, missing credentials, fake-server init, status success/failure, destroy refusal without `--yes`, destroy dry-run, secret redaction.
- Config metadata persistence without clobbering repo links.

If a required area is not tested, either add a verifier-owned test if small or FAIL with a concrete gap.

## 7. Docs Review

Verify docs:

- Add `orun backend` to command map and sidebar.
- Explain `init`, `status`, and `destroy` behavior.
- Document Cloudflare permissions.
- Document GitHub OAuth follow-up without asking for GitHub PATs.
- Document env vars:
  - `CLOUDFLARE_ACCOUNT_ID`
  - `CLOUDFLARE_API_TOKEN`
  - `ORUN_SESSION_SECRET`
  - `GITHUB_CLIENT_ID`
  - `GITHUB_CLIENT_SECRET`
  - `ORUN_DASHBOARD_URL`
- Explain `--dry-run`, `--json`, and `destroy --yes`.
- Explain config/security model and that secrets are not stored.
- Document known gaps accurately:
  - live smoke not run if not run
  - cron trigger not configured by bootstrap if still true
  - any compatibility flags not configured

# Local Checks

Run in `/Users/irinelinson/sourceplane/orun`:

```bash
go test ./...
go test -race ./...
go vet ./...
go test ./cmd/orun ./internal/... -run 'Backend|Cloudflare|Auth|Cloud|Remote'
```

Run dry-run/missing-credential smokes. Use a temporary HOME so local config is not polluted:

```bash
tmp_home="$(mktemp -d)"
HOME="$tmp_home" go run ./cmd/orun backend init --dry-run --json
HOME="$tmp_home" go run ./cmd/orun backend destroy --dry-run --json
HOME="$tmp_home" go run ./cmd/orun backend status --json
```

Expected behavior:

- `init --dry-run --json` succeeds without real Cloudflare calls if implementation allows dry-run without credentials. If it requires credentials for dry-run, decide whether that violates the task.
- `destroy --dry-run --json` should not delete anything.
- `status --json` may fail cleanly without credentials/metadata; record exact behavior.

If docs build tooling is available, run the website docs check/build. If not, document the gap.

# Live Cloudflare Smoke

If a safe disposable Cloudflare account/token is available, perform a live smoke using a unique resource prefix, then destroy it:

```bash
orun backend init --name orun-api-smoke-<suffix> --d1-name orun-db-smoke-<suffix> --r2-bucket orun-storage-smoke-<suffix> ...
orun backend status --name orun-api-smoke-<suffix>
orun backend destroy --name orun-api-smoke-<suffix> --yes
```

Do not use production resource names for destructive tests. Do not log credentials. Confirm no resources remain.

If live credentials are unavailable, the verifier may still PASS only if:

- API shapes were checked against official Cloudflare docs.
- Fake-server tests and dry-run flows are strong.
- The verifier report clearly marks live Cloudflare smoke as not run.
- Any API-shape uncertainty is recorded as a risk or blocker.

# Acceptance Criteria

Task 0015 may PASS only if:

- `orun backend init/status/destroy` command group is registered and usable.
- Embedded Worker bundle and all migrations are present, current, sorted, and secret-free.
- Cloudflare client uses direct REST APIs and has credible endpoint/body shapes.
- `init` is idempotent, supports dry-run/JSON, sets vars/secrets safely, and stores only non-secret metadata.
- `status` reports readiness and exits non-zero for missing/incompatible resources.
- `destroy` is guarded by `--yes`/managed metadata and does not delete arbitrary resources casually.
- Secrets and API tokens are never printed or stored in config.
- Existing auth/cloud/remote-state behavior is not regressed.
- Local tests, race, vet, and targeted tests pass.
- CI is green and logs are understood.
- Docs cover setup, permissions, OAuth follow-up, no-PAT flow, env vars, dry-run/JSON, and destroy safety.

# FAIL Criteria

FAIL if any of the following are true:

- Worker module upload shape is likely incompatible with Cloudflare's actual API.
- Durable Object, D1, or R2 bindings are missing or incorrect.
- Migrations can be marked applied before successful execution.
- `destroy` can delete unmanaged resources by name without an explicit override.
- Config stores Cloudflare API tokens, GitHub client secrets, session secrets, Orun access tokens, or refresh tokens.
- Text or JSON output leaks secret values.
- Existing auth/cloud/remote-state behavior is broken.
- Required local tests fail.
- PR CI is stale or failing.
- Significant Cloudflare API gaps are hidden behind fake tests without documentation/proposal.

# Bookkeeping

If PASS:

1. Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0015-verifier.md` with:
   - `Result: PASS`
   - Summary
   - PR / CI Context
   - Checks
   - Cloudflare API Review
   - Acceptance Review
   - Live Smoke
   - Issues
   - Risk Notes
   - Spec Proposals
   - Recommended Next Move
2. Update `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`:
   - add `15` to `completed`
   - keep `repo_health` yellow unless the old Task 0012 local conformance note is resolved
   - set `next_focus` to the next highest-leverage task
   - add a concise Task 0015 PASS note
3. Include `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0015.md` in bookkeeping if it is still untracked and correct.
4. Commit/push any `orun-backend` verifier bookkeeping separately if needed.
5. If verifier fixes in `sourceplane/orun` are needed and small, commit them to PR #86 branch, push, wait for CI, and inspect logs.
6. Merge PR #86 only after local checks, Cloudflare API review, and CI logs are acceptable.
7. After merge, checkout `main` in `sourceplane/orun` and fast-forward pull from `origin/main`.

If FAIL:

1. Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0015-verifier.md` with `Result: FAIL`.
2. Include concrete blockers with file/line references and exact failing commands.
3. Leave PR #86 open.
4. Do not add Task 0015 to `completed`.
5. Leave clear PR feedback/review comments with the blockers.
6. Recommend a bounded Task 0015.x remediation if needed.

# When Done Report

Write:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0015-verifier.md
```

Use the standard verifier report shape:

- Result: PASS|FAIL
- Summary
- PR / CI Context
- Checks
- Cloudflare API Review
- Acceptance Review
- Live Smoke
- Issues
- Risk Notes
- Spec Proposals
- Recommended Next Move
