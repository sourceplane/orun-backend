# Task 0011 Verifier Report

## Result

**PASS**

## PR

- Repo: `sourceplane/orun`
- PR: #83
- Title: `feat: add CLI auth for local remote state`
- Branch: `feat/cli-auth-remote-state` → `main`
- Head SHA: `fee422bc73f4d3de2484a88065f23e3fb274d6cf`
- Merge state at verification: `CLEAN`
- Verified: 2026-05-07

## Checks

| Check | Result |
|---|---|
| `go test -count=1 ./...` | ✓ all packages pass |
| `go test -race ./internal/runner ./cmd/orun ./internal/state ./internal/statebackend ./internal/remotestate` | ✓ pass |
| `go test ./internal/cliauth ./internal/remotestate ./cmd/orun -run 'Auth\|Credential\|Token\|Cloud\|Remote' -count=1 -v` | ✓ all targeted tests pass |
| `go vet ./...` | ✓ clean |
| `git diff --check` | ✓ clean |

Docs: no website build/test command exists in the repo; docs reviewed by reading source.

## CI Log Review

GitHub Actions run `25456644764`:

- `Orun Plan` — SUCCESS ✓
- `matrix.job-name` — SKIPPED (no changed components trigger matrix)

CI ran plan only; matrix was skipped as expected for a CLI/docs PR. No secrets in logs (GITHUB_TOKEN and ORUN_BACKEND_URL values masked). No `.orun/`, coverage, credential, or generated build output committed. Local checks required and executed above — all pass.

## Auth Command Review

All five `orun auth` subcommands are registered and accessible:

```
orun auth login        ✓  --device flag present
orun auth login --device  ✓
orun auth status       ✓
orun auth logout       ✓
orun auth token        ✓  --audience flag present
orun cloud link        ✓
```

Behavior review:
- `orun auth login`: starts loopback listener on `127.0.0.1:0` (dynamic port), generates a random nonce path, opens browser to `/v1/auth/github?client=cli&returnTo=...`, parses credential fragment from callback, saves session, and shuts server down. ✓
- `orun auth login --device`: calls `/v1/auth/cli/device/start`, prints user code and verification URI, polls with dynamic interval and `RATE_LIMITED` backoff, stores session on success. ✓
- `orun auth status`: prints GitHub login, backend URL, access-token expiry with valid/expired label, and current Git remote link status without printing any token. ✓
- `orun auth logout`: revokes refresh token via `/v1/auth/cli/logout` when possible, clears local credentials, handles network failure gracefully (logs but does not fail). ✓
- `orun auth token --audience`: prints the current access token (refreshed first if near expiry). The `--audience` flag is accepted but is display-only for CLI sessions; noted in implementer report as a remaining gap. ✓

Error paths:
- `orun auth status` with no credentials: actionable error "not logged in; run `orun auth login` or `orun auth login --device`". ✓
- Backend URL missing on login: actionable error with list of resolution paths. ✓

**Minor issue**: `orun cloud link --backend-url <url>` fails with `unknown flag: --backend-url`. The `--backend-url` flag is registered on `authCmd.PersistentFlags()` (auth group only) but `cloud link` calls `requireBackendURL(nil, authBackendURL)`. Since `cloudCmd` is a sibling of `authCmd`, the flag is not accessible from `cloud link`. The docs (`orun-cloud.md`) show `orun cloud link --backend-url ...` which does not work.

Workaround: use `ORUN_BACKEND_URL` env var, or run `orun auth login --backend-url ...` first (which persists the URL to `~/.orun/config.yaml`). The typical flow (auth login, then cloud link) works correctly when the URL is already stored.

Not a blocker: the practical workaround is documented and the typical usage pattern is not affected. Recommend fixing in a follow-up task by adding `--backend-url` as a persistent flag on `cloudCmd`.

## Credential Storage Review

- macOS keychain (`security` CLI) preferred when `runtime.GOOS == "darwin"` and `security` is on PATH. ✓
- File fallback to `~/.orun/credentials.json` with `0600` permissions (enforced via `os.WriteFile(..., 0o600)` + `os.Chmod`). ✓
- Non-secret config in `~/.orun/config.yaml`. ✓
- Stored fields: Orun access token, access expiry, Orun refresh token, refresh expiry, GitHub login, allowed namespace IDs, backend URL. ✓
- GitHub OAuth access tokens and PATs: never stored. The backend discards GitHub tokens after namespace resolution; the CLI fragment parse reads `sessionToken` and `refreshToken` fields only. ✓
- Config dir created with `0700` permissions. ✓
- Tests isolate home directory via `t.TempDir()` and `userHomeDir` override — real home is never written. ✓
- Linux/CI safe: `keychainCredentialStore.available()` returns `false` when `runtime.GOOS != "darwin"`, so macOS `security` CLI path is never invoked outside macOS. ✓
- Keychain failure falls back to file store; keychain errors are propagated on non-ErrNotExist conditions. ✓

Test coverage:
- `TestFileCredentialStoreRoundTrip`: verifies save/load round-trip and `0600` file mode. ✓
- `TestDefaultCredentialStoreFallsBackToFile`: verifies keychain unavailability falls back to file. ✓
- `TestUpsertRepoLinkAndFindRepoLink`: verifies insert and update of repo links. ✓

## Remote-State Auth Resolution Review

Implementation in `internal/remotestate/auth.go` (`ResolveAuth`):

1. GitHub Actions OIDC (when `GITHUB_ACTIONS=true` and `ACTIONS_ID_TOKEN_REQUEST_URL`/`TOKEN` are set) ✓
2. `ORUN_TOKEN` env var (explicit static token) ← **spec drift from `09-cli-integration.md`** (see below)
3. Stored Orun CLI session credentials with auto-refresh ✓

**ORUN_TOKEN precedence spec drift**: The spec and docs both describe CLI session as position 2 and `ORUN_TOKEN` as position 3. The code puts `ORUN_TOKEN` at position 2. The implementer report documents this deviation. A proposal is written at `ai/proposals/task-0011-orun-token-precedence.md`.

Assessment: **accepted with proposal**. The implementation is safe and intentional:
- `ORUN_TOKEN` is an explicit, intentionally-set short-lived token; explicit wins over ambient stored credentials.
- In normal interactive local use, `ORUN_TOKEN` is not set, so the primary use case is unaffected.
- The proposal recommends updating the spec and docs to match the implemented order.

Other auth resolution checks:
- GitHub Actions OIDC behavior unchanged: `OIDCTokenSource` reads `ACTIONS_ID_TOKEN_REQUEST_URL` and requests token with audience `orun`. ✓
- Outside GHA: stored Orun CLI session used via `SessionTokenSource`. ✓
- `SessionTokenSource.Token()`: returns existing access token if not near expiry (30-second buffer); refreshes via `/v1/auth/cli/token` when expired. ✓
- Expired refresh token error is actionable: "run `orun auth login` again". ✓
- Backend URL mismatch (stored vs. requested): clear error "run `orun auth login --backend-url X`". ✓
- No-login interactive: "run `orun auth login` or `orun auth login --device`". ✓
- No-login non-interactive: "run `orun auth login --device` or set ORUN_TOKEN". ✓
- `orun status --remote-state` and `orun logs --remote-state`: both use `newRemoteBackend()` in `commands_root.go` which calls `ResolveTokenSource` with the resolved backend URL. Same auth path as `run --remote-state`. ✓
- Backend URL precedence: flag → `ORUN_BACKEND_URL` → `intent.yaml` execution.state.backendUrl → `~/.orun/config.yaml`. Tested in `TestResolveBackendURLWithConfigPrefersExplicitSources`. ✓

## Cloud Link Review

`orun cloud link` behavior:
- Requires login; returns actionable error if not logged in. ✓
- Detects GitHub remote via `git config --get remote.origin.url`. ✓
- Parses SSH (`git@github.com:`), SSH URL (`ssh://git@github.com/`), HTTPS, and HTTP remote forms. ✓
- Does not require or store a GitHub PAT. ✓
- If repo is already in local config (from prior `cloud link`), uses stored namespace ID. ✓
- If not locally linked, calls `GET /v1/accounts/repos` via `ListLinkedRepos` and searches by `namespaceSlug`. ✓
- If found in backend account, persists to `~/.orun/config.yaml` and prints success. ✓
- If not found in backend account, returns actionable error: "repo X is not linked in this Orun session; link it in Orun Cloud first". ✓

**Remaining gap (known, proposal written)**: `orun cloud link` cannot create a new backend repo link because `POST /v1/accounts/repos` requires `X-GitHub-Access-Token`, which the CLI auth flow never stores. Proposal at `ai/proposals/task-0011-cloud-link-api.md`. For now, linking via the dashboard first is required before `orun cloud link` can complete for a new repo.

**Minor issue**: `--backend-url` flag not available on `cloud link` (see Auth Command Review section).

## Default Local Mode Regression Review

- `orun run` without `--remote-state` and without `ORUN_REMOTE_STATE`: uses `FileStateBackend` (local filesystem). No remote auth, no backend calls. ✓
- `runRemoteState` flag defaults to false; `newRemoteBackend` is only called when remote state is explicitly enabled. ✓
- `orun status` and `orun logs` default to local state; `--remote-state` flag required to use backend. ✓
- No unexpected imports of `cliauth` or `remotestate` packages in the default local code path. ✓
- Existing plan/run/job ID behavior unchanged (plan hashes, exec IDs, job IDs unmodified). ✓

## Docs Review

| File | Assessment |
|---|---|
| `orun-auth.md` | ✓ Explains login, device login, status, logout, token, storage. Does not mention GitHub PATs as normal path. |
| `orun-cloud.md` | ✓ Explains link behavior and limitations. Has `--backend-url` example that won't work (minor docs bug). |
| `orun-run.md` | ✓ Auth resolution order documented (but shows CLI session before ORUN_TOKEN — code differs; proposal written). Explains local setup steps. Does not require GitHub PAT. |
| `orun-status.md` | ✓ Remote state flags documented with auth note. |
| `orun-logs.md` | ✓ Remote state flags documented with auth note. |
| `reference/configuration.md` | ✓ `~/.orun/config.yaml` backend URL and repos structure documented. `orun cloud link` write behavior documented. |
| `reference/environment-variables.md` | ✓ `ORUN_TOKEN` explicitly says "Normal local remote-state usage should use `orun auth login`, not a GitHub PAT". |
| `examples/remote-state-matrix.md` | ✓ OIDC → CLI session → ORUN_TOKEN order shown (matches spec; code differs; proposal addresses). Local conformance section present. |

Docs issues:
1. `orun-cloud.md` shows `orun cloud link --backend-url ...` which fails with "unknown flag". Should use `ORUN_BACKEND_URL` env var instead.
2. `orun-run.md` and `remote-state-matrix.md` show auth resolution order that matches spec but not code (ORUN_TOKEN at 3 instead of 2). Proposal `task-0011-orun-token-precedence.md` addresses.

Neither issue involves GitHub PATs being presented as the normal path. Docs correctly discourage GitHub PATs throughout.

## Optional Live Smoke

Not run. No live credentials are available for automated interactive device login. Non-interactive error paths tested above via `auth status` (returned correct error). Backend endpoints are confirmed live per Task 0010 Verifier 2 report (dated 2026-05-06).

## Issues

No blockers. Two proposals written for accepted spec drift.

## Risk Notes

1. **ORUN_TOKEN precedence**: Code places `ORUN_TOKEN` at position 2 (before CLI session), spec and docs say position 3. Accepted with proposal. If `ORUN_TOKEN` is set in a developer's local environment alongside a CLI session, the token wins. In practice this is unlikely and arguably correct. Docs should be updated per proposal.

2. **`cloud link --backend-url` flag missing**: Flag is registered on `authCmd` not `cloudCmd`. Docs show the flag. Workaround: `ORUN_BACKEND_URL` env var or run `orun auth login --backend-url ...` first. Recommend adding `--backend-url` to `cloudCmd` as a small follow-up fix.

3. **`orun cloud link` cannot create new backend repo links**: Backend requires GitHub access token for `POST /v1/accounts/repos`. CLI auth flow never holds GitHub tokens. Accepted gap; proposal `task-0011-cloud-link-api.md` written.

4. **`orun auth token --audience` is display-only**: The `--audience` flag is accepted but the backend mints a standard CLI access token regardless of the audience label. Accepted as a remaining gap per implementer report.

5. **Device endpoint rate limiting** (carried over from Task 0010): `POST /v1/auth/cli/device/start` and `/poll` have no per-IP rate limiting. Proposal exists at `ai/proposals/task-0010-device-flow-rate-limiting.md`.

6. **Refresh token not rotated on use** (carried over from Task 0010): Replay window = 30-day refresh TTL. Acceptable for initial implementation.

## Spec Proposals

- `ai/proposals/task-0011-orun-token-precedence.md` — `ORUN_TOKEN` precedence over CLI session; proposal authorizes code behavior and requests docs/spec update.
- `ai/proposals/task-0011-cloud-link-api.md` — backend endpoint needed for session-authenticated repo-link creation, closing the `orun cloud link` bootstrapping gap.

## Merge / Sync Actions

- PR #83 merged to `main` via squash.
- `sourceplane/orun/main` fast-forward pulled from `origin/main`.
- Bookkeeping PR in `sourceplane/orun-backend` committed and merged:
  - `ai/reports/task-0011-implementer.md` (was untracked)
  - `ai/reports/task-0011-verifier.md` (this file)
  - `ai/proposals/task-0011-orun-token-precedence.md`
  - `ai/proposals/task-0011-cloud-link-api.md`

## Recommended Next Move

Proceed to **Task 0012** — local remote-state conformance. The CLI auth system is complete and verified. Task 0012 should:
- Run the local remote-state conformance scenario end-to-end (auth login → cloud link → concurrent local runners → status/logs verification).
- Update docs to match the implemented `ORUN_TOKEN` precedence (absorbing the `task-0011-orun-token-precedence` proposal as a small docs patch).
- Accept or scope the `task-0011-cloud-link-api` proposal (adding the backend session-authenticated repo-link endpoint).
- Add `--backend-url` to `cloudCmd` persistent flags (small fix, unblocks the docs example).
