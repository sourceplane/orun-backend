# Task 0015 Implementer Report

## Summary

Implemented the first production-grade self-hosted backend bootstrap slice in the `orun` CLI. A user with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` can now run:

```bash
orun backend init
orun backend status
orun backend destroy
```

to provision, inspect, and intentionally remove an Orun backend composed of a Cloudflare Worker script, D1 database with migrations, R2 bucket, Worker bindings, and required vars/secrets.

All Cloudflare operations use direct REST APIs — Wrangler is not required at runtime.

## Primary Repo and Branch

- **Repo:** `sourceplane/orun`
- **Branch:** `codex/task-0015-backend-bootstrap`
- **PR:** https://github.com/sourceplane/orun/pull/86

## Files Changed

### New files

- `cmd/orun/command_backend.go` — `orun backend init/status/destroy` commands
- `cmd/orun/command_backend_test.go` — CLI command layer tests
- `internal/backendbundle/bundle.go` — embedded Worker bundle, migrations, manifest
- `internal/backendbundle/bundle_test.go` — bundle tests
- `internal/backendbundle/embed/manifest.json` — bundle manifest
- `internal/backendbundle/embed/worker/index.js` — embedded Worker bundle (copied from orun-backend dist)
- `internal/backendbundle/embed/migrations/0001_init.sql` through `0005_catalog_index.sql` — embedded migrations
- `internal/cloudflare/client.go` — Cloudflare REST API client
- `internal/cloudflare/client_test.go` — Cloudflare client tests with fake httptest servers
- `website/docs/cli/orun-backend.md` — new CLI docs page

### Modified files

- `cmd/orun/commands_root.go` — register backend command
- `internal/cliauth/types.go` — added `BackendBootstrap` type, extended `Config`
- `internal/cliauth/storage.go` — added `SaveBootstrapMetadata`, `LoadBootstrapMetadata`, `ClearBootstrapMetadata`
- `website/docs/cli/orun.md` — added `orun backend` to command map
- `website/docs/reference/environment-variables.md` — added Cloudflare and OAuth env vars
- `website/sidebars.js` — added `cli/orun-backend` entry

## Backend Bundle Provenance

- **Source repo:** `sourceplane/orun-backend`
- **Commit SHA:** `3429079e7c3848fddd5548675a92e8a50a41e4cb`
- **Bundle date:** 2026-05-08
- **Artifacts:** `apps/worker/dist/index.js` (124K), migrations `0001`–`0005`
- **Refresh procedure:** documented in `internal/backendbundle/bundle.go` package doc

## Cloudflare API Coverage

| Operation | Endpoint | Method |
|---|---|---|
| List D1 databases | `GET /accounts/{id}/d1/database` | ✓ |
| Create D1 database | `POST /accounts/{id}/d1/database` | ✓ |
| Delete D1 database | `DELETE /accounts/{id}/d1/database/{uuid}` | ✓ |
| Execute D1 SQL | `POST /accounts/{id}/d1/database/{uuid}/query` | ✓ |
| List R2 buckets | `GET /accounts/{id}/r2/buckets` | ✓ |
| Create R2 bucket | `POST /accounts/{id}/r2/buckets` | ✓ |
| Delete R2 bucket | `DELETE /accounts/{id}/r2/buckets/{name}` | ✓ |
| Get Worker script | `GET /accounts/{id}/workers/scripts/{name}` | ✓ |
| Upload Worker script | `PUT /accounts/{id}/workers/scripts/{name}` (multipart) | ✓ |
| Delete Worker script | `DELETE /accounts/{id}/workers/scripts/{name}` | ✓ |
| Set Worker vars | `PATCH /accounts/{id}/workers/scripts/{name}/settings` | ✓ |
| Set Worker secret | `PUT /accounts/{id}/workers/scripts/{name}/secrets` | ✓ |
| List Worker secrets | `GET /accounts/{id}/workers/scripts/{name}/secrets` | ✓ |
| Get workers.dev subdomain | `GET /accounts/{id}/workers/subdomain` | ✓ |
| Enable subdomain route | `POST /accounts/{id}/workers/scripts/{name}/subdomain` | ✓ |

## CLI Commands Added

- `orun backend init [flags]` — full idempotent provisioning with `--dry-run` and `--json`
- `orun backend status [flags]` — readiness check with `--json`; safe for CI
- `orun backend destroy [flags]` — managed-resource destruction with `--yes` guard, `--dry-run`, `--adopted`

All commands accept `--account-id` and `--api-token` flags as overrides for the env vars.

## Config/Security Notes

- `BackendBootstrap` struct stored in `~/.orun/config.yaml` contains only non-secret metadata (account ID, resource names/UUIDs, bundle commit SHA, init timestamp).
- `backend.url` is set to the Worker URL when discoverable, enabling auth/cloud/run commands to find the backend without additional flags.
- Config file remains `0600` permissions (enforced by `SaveConfig`).
- API tokens, session secrets, GitHub client secrets, Orun access tokens, and refresh tokens are never stored in config or printed in output.
- `ORUN_SESSION_SECRET` is generated with `crypto/rand` (32 bytes, hex-encoded) when not provided.
- Error messages for secret operations include `(value redacted)` suffix; error text is checked in tests.

## Docs Updated

- `website/docs/cli/orun-backend.md` — full command reference with Cloudflare permissions, GitHub OAuth setup, env vars, config security notes, update procedure
- `website/docs/cli/orun.md` — `orun backend` added to command map
- `website/docs/reference/environment-variables.md` — `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `ORUN_SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ORUN_DASHBOARD_URL`
- `website/sidebars.js` — `cli/orun-backend` added to CLI section

## Tests Run

```
go test ./...              — PASS (all 24 packages)
go test -race ./...        — PASS
go vet ./...               — PASS
go test ./cmd/orun ./internal/... -run 'Backend|Cloudflare|Auth|Cloud|Remote'  — PASS
```

Smoke commands verified:
```
go run ./cmd/orun backend init --dry-run --json   → correct JSON
go run ./cmd/orun backend destroy --dry-run --json → correct JSON
go run ./cmd/orun backend status --json           → credential error (expected, no creds in env)
```

## Live Cloudflare Smoke

**Not run.** No live Cloudflare credentials were available in the implementer environment. All verification is based on:
- Fake `httptest.Server` transports covering the full Cloudflare client API surface
- `--dry-run` mode exercising all init/destroy code paths without network calls

## Assumptions

1. Cloudflare's D1 query API returns `[]{results, success}` even for DDL statements (tested via fake server).
2. Worker module upload uses `PUT /accounts/{id}/workers/scripts/{name}` with multipart form-data, with `metadata` and `index.js` parts — confirmed against Cloudflare API docs.
3. `GetWorkerScript` returns error codes `10007` or `10090` for non-existent scripts — treated as nil-not-found.
4. Workers.dev subdomain discovery is best-effort; `--public-url` flag allows manual override.

## Spec Proposals

None. All required behavior was implementable with the Cloudflare REST API.

### Migration ledger note

Cloudflare's D1 API does not expose Wrangler's internal migration ledger (`d1_migrations` table). The implementation uses `_orun_migrations` (an Orun-managed table) to track applied migrations idempotently. This is documented in the code and in `orun-backend.md`.

## Remaining Gaps

- **Live smoke test**: Not run. A full live end-to-end test with a real Cloudflare account would confirm the multipart Worker upload shape and workers.dev routing.
- **Worker cron trigger**: The `wrangler.jsonc` declares a `*/15 * * * *` cron trigger for GC. This is not set via the REST API in this implementation (Cloudflare's script upload endpoint does not accept cron configuration in the same request; it would require a separate Triggers API call). Added as a known gap.
- **Worker `compatibility_flags`**: Not set. Defaults to none (safe for the current bundle).

## PR Number

**PR #86:** https://github.com/sourceplane/orun/pull/86
