# task-0011 implementer report: CLI auth commands and local remote-state sessions

## Summary

Implemented CLI-side Orun session auth in `sourceplane/orun` for local remote-state usage. Added `orun auth login`, `orun auth login --device`, `orun auth status`, `orun auth logout`, `orun auth token`, and `orun cloud link`; added secure credential/config storage; and changed local remote-state auth resolution to use Orun CLI sessions with automatic refresh while preserving GitHub Actions OIDC behavior.

## Files Changed

### New files

- `/Users/irinelinson/sourceplane/orun/internal/cliauth/types.go`
- `/Users/irinelinson/sourceplane/orun/internal/cliauth/storage.go`
- `/Users/irinelinson/sourceplane/orun/internal/cliauth/backend.go`
- `/Users/irinelinson/sourceplane/orun/internal/cliauth/storage_test.go`
- `/Users/irinelinson/sourceplane/orun/cmd/orun/command_auth.go`
- `/Users/irinelinson/sourceplane/orun/cmd/orun/command_cloud.go`
- `/Users/irinelinson/sourceplane/orun/cmd/orun/remote_config.go`
- `/Users/irinelinson/sourceplane/orun/cmd/orun/auth_config_test.go`
- `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun-auth.md`
- `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun-cloud.md`

### Updated files

- `/Users/irinelinson/sourceplane/orun/cmd/orun/commands_root.go`
- `/Users/irinelinson/sourceplane/orun/cmd/orun/command_run.go`
- `/Users/irinelinson/sourceplane/orun/cmd/orun/command_status.go`
- `/Users/irinelinson/sourceplane/orun/cmd/orun/command_logs.go`
- `/Users/irinelinson/sourceplane/orun/internal/remotestate/auth.go`
- `/Users/irinelinson/sourceplane/orun/internal/remotestate/auth_test.go`
- `/Users/irinelinson/sourceplane/orun/internal/remotestate/client.go`
- `/Users/irinelinson/sourceplane/orun/internal/statebackend/backend.go`
- `/Users/irinelinson/sourceplane/orun/internal/statebackend/remote.go`
- `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun.md`
- `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun-run.md`
- `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun-status.md`
- `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun-logs.md`
- `/Users/irinelinson/sourceplane/orun/website/docs/reference/environment-variables.md`
- `/Users/irinelinson/sourceplane/orun/website/docs/reference/configuration.md`
- `/Users/irinelinson/sourceplane/orun/website/docs/examples/remote-state-matrix.md`

## Auth Commands

- Added `orun auth` command group.
- `orun auth login` performs browser loopback login against `/v1/auth/github?client=cli&returnTo=...`, captures the callback fragment locally, stores Orun session credentials, and shuts the loopback server down.
- `orun auth login --device` uses `/v1/auth/cli/device/start` and `/v1/auth/cli/device/poll`, prints the user code and verification URL, polls until success, and stores Orun credentials.
- `orun auth status` prints GitHub login, backend URL, access-token expiry, and whether the current Git remote is locally linked.
- `orun auth logout` revokes the refresh token through `/v1/auth/cli/logout` when possible and clears local credentials.
- `orun auth token --audience orun-backend` prints the currently valid Orun access token after refresh if needed.

## Credential Storage

- Added a small `internal/cliauth` package.
- Secrets are stored in the macOS keychain via the `security` CLI when available.
- Fallback storage is `~/.orun/credentials.json` with `0600` permissions.
- Stored credential fields:
  - Orun access token
  - access-token expiry
  - Orun refresh token
  - refresh-token expiry
  - GitHub login
  - allowed namespace IDs
  - backend URL
- Non-secret config is stored in `~/.orun/config.yaml`.
- Added local repo-link persistence in config so local session-authenticated `POST /v1/runs` can send the required `namespaceId`.
- No GitHub OAuth access tokens or PATs are stored.

## Remote-State Auth Resolution

- Replaced the old `OIDC or ORUN_TOKEN only` remote-state auth resolution with:
  1. GitHub Actions OIDC when `ACTIONS_ID_TOKEN_REQUEST_URL` is available
  2. explicit `ORUN_TOKEN` fallback for short-lived Orun machine tokens
  3. stored Orun CLI session credentials outside GitHub Actions
- Added automatic access-token refresh through `/v1/auth/cli/token` when the stored token is expired or near expiry.
- Local `orun run --remote-state` now resolves the current repo link from `~/.orun/config.yaml` and passes `namespaceId` in `POST /v1/runs` for session-authenticated local runs.
- `orun status --remote-state` and `orun logs --remote-state` now use the same backend URL resolution path: flag, env, intent, then `~/.orun/config.yaml`.
- GitHub Actions OIDC flow remains unchanged.

## Docs

- Added dedicated docs pages for `orun auth` and `orun cloud`.
- Updated `orun run`, `orun status`, `orun logs`, CLI index, environment variables, configuration, and remote-state example docs.
- Documented:
  - local remote-state login
  - headless device login
  - auth status/logout/token
  - `orun cloud link`
  - backend URL resolution order including `~/.orun/config.yaml`
  - remote-state auth resolution order
  - no GitHub PAT requirement for normal local remote-state usage

## Checks Run

In `/Users/irinelinson/sourceplane/orun`:

- `go test ./...` — all packages pass (verified 2026-05-07)
- `go test -race ./internal/runner ./cmd/orun ./internal/state ./internal/statebackend ./internal/remotestate` — all pass
- `go vet ./...` — clean
- `git diff --check` — clean

All passed. Working tree is clean on branch `feat/cli-auth-remote-state`.

## Assumptions

- Using the macOS `security` CLI is an acceptable way to prefer the OS credential store without adding a new Go dependency.
- For browser loopback login, the backend session JWT `exp` claim is the authoritative access-token expiry when the callback fragment does not return a separate `expiresAt` field.
- `orun cloud link` can safely persist already-known backend-linked repos locally without needing to create the link itself when the backend has not exposed a session-safe repo-link creation path.

## Spec Proposals

1. Add a backend endpoint that allows the CLI to link or resolve the current repo namespace using only the existing Orun CLI session, without requiring a raw GitHub OAuth access token to be returned to or stored by the CLI.

Reason:

- The current backend `POST /v1/accounts/repos` contract requires `X-GitHub-Access-Token`, but Task 0011 explicitly disallows storing or treating GitHub OAuth tokens as Orun credentials.
- Local session-authenticated `POST /v1/runs` requires `namespaceId`, so a complete private-repo `orun cloud link` flow needs a backend-assisted repo-slug to namespace-ID resolution/linking path that does not expose GitHub tokens to the CLI.

## Remaining Gaps

1. `orun cloud link` currently supports the safe subset: it persists repo linkage locally when the repo is already linked in the backend account and visible via `GET /v1/accounts/repos`. It does not create a new backend repo link because the current backend contract requires a GitHub access token header that the CLI auth flow never receives.

2. For private repos that are not already linked and not present in `GET /v1/accounts/repos`, the CLI cannot derive the required `namespaceId` without the proposed backend lookup/link endpoint above.

3. `orun auth token --audience` accepts the flag but, for CLI sessions, the backend currently mints the standard Orun CLI access token shape rather than a separate audience-specific token contract.

## PR Number

PR #83 — `sourceplane/orun` — `feat: add CLI auth for local remote state`
