# Task 0011 Verifier

# Agent

Verifier

# Current Repo Context

Task 0011 implementation is complete and open for verification.

Primary implementation repo:

```text
/Users/irinelinson/sourceplane/orun
```

Planning/spec/bookkeeping repo:

```text
/Users/irinelinson/sourceplane/orun-backend
```

Task 0010 backend prerequisite is complete:

- `sourceplane/orun-backend` PR #27 merged.
- Live Worker: `https://orun-api.sourceplane.ai`.
- Task 0010 verifier reports PASS for code and deployed infra.
- Backend supports CLI loopback OAuth, device flow, refresh/logout, and CLI-session mutable remote-state authorization.

Open PR to verify:

- Repo: `sourceplane/orun`
- PR: #83
- URL: `https://github.com/sourceplane/orun/pull/83`
- Title: `feat: add CLI auth for local remote state`
- Branch: `feat/cli-auth-remote-state`
- Base: `main`
- Head SHA: `fee422bc73f4d3de2484a88065f23e3fb274d6cf`
- Merge state at verifier prompt creation: `CLEAN`
- CI run: `https://github.com/sourceplane/orun/actions/runs/25456644764`
- CI surface at verifier prompt creation:
  - `Orun Plan`: success
  - `matrix.job-name`: skipped

Important: PR CI does not prove the full Go test suite. Local verification must run the required Go checks.

Open `sourceplane/orun` PRs that are not Task 0011:

- PR #70: `test: verify dep-wait fail-fast fix (v1.12.12)`
- PR #68: `Test workflow`

Do not merge or modify those as part of Task 0011 unless the user explicitly redirects.

Local implementer report:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0011-implementer.md
```

At verifier prompt creation, this report exists locally in `orun-backend` and may be untracked. Preserve it in verifier bookkeeping.

# Objective

Verify PR #83 against Task 0011.

Task 0011 is complete only if `sourceplane/orun` has a safe, usable local CLI auth system that lets local `orun run --remote-state` use Orun CLI session credentials, while preserving GitHub Actions OIDC and default local filesystem execution.

Verification must confirm:

1. `orun auth` commands exist and behave correctly.
2. `orun cloud link` is useful and safe.
3. Credential storage does not store GitHub OAuth access tokens or PATs.
4. Remote-state token resolution preserves GitHub Actions OIDC and adds local CLI session auth.
5. Expired access tokens refresh automatically.
6. `orun run` without `--remote-state` remains unchanged.
7. Docs are accurate and do not present GitHub PATs as the normal path.
8. Required tests pass locally.
9. Any spec/scope drift has a proposal file under `orun-backend/ai/proposals/`.

If PASS:

- Merge PR #83 in `sourceplane/orun`.
- Checkout `/Users/irinelinson/sourceplane/orun/main` and fast-forward pull from `origin/main`.
- Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0011-verifier.md`.
- Update `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`:
  - add `11` to `completed`
  - set `current_task` to `12`
  - set `next_focus` to `task-0012-local-remote-state-conformance`
  - keep `repo_health` green
  - set `last_verified` to the verification date
  - add concise notes for PR #83 and any accepted residual risk
- Ensure `ai/reports/task-0011-implementer.md`, `ai/reports/task-0011-verifier.md`, and any required proposal files are committed through a small `sourceplane/orun-backend` bookkeeping PR, merged, and local `main` fast-forwarded.

If FAIL:

- Do not merge PR #83.
- Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0011-verifier.md` with concrete blockers.
- Leave clear PR feedback on PR #83.
- Recommend Task 0011.1 remediation scope.

# Read First

Read these files in `sourceplane/orun-backend`:

1. `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0011.md`
2. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0011-implementer.md`
3. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0010-verifier.md`
4. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0010-verifier2.md`
5. `/Users/irinelinson/sourceplane/orun-backend/spec/06-auth.md`
6. `/Users/irinelinson/sourceplane/orun-backend/spec/09-cli-integration.md`
7. `/Users/irinelinson/sourceplane/orun-backend/agents/orchestrator.md`

Read these files in `sourceplane/orun`:

1. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_auth.go`
2. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_cloud.go`
3. `/Users/irinelinson/sourceplane/orun/cmd/orun/remote_config.go`
4. `/Users/irinelinson/sourceplane/orun/cmd/orun/auth_config_test.go`
5. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_run.go`
6. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_status.go`
7. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_logs.go`
8. `/Users/irinelinson/sourceplane/orun/cmd/orun/commands_root.go`
9. `/Users/irinelinson/sourceplane/orun/internal/cliauth/types.go`
10. `/Users/irinelinson/sourceplane/orun/internal/cliauth/storage.go`
11. `/Users/irinelinson/sourceplane/orun/internal/cliauth/backend.go`
12. `/Users/irinelinson/sourceplane/orun/internal/cliauth/storage_test.go`
13. `/Users/irinelinson/sourceplane/orun/internal/remotestate/auth.go`
14. `/Users/irinelinson/sourceplane/orun/internal/remotestate/auth_test.go`
15. `/Users/irinelinson/sourceplane/orun/internal/remotestate/client.go`
16. `/Users/irinelinson/sourceplane/orun/internal/statebackend/backend.go`
17. `/Users/irinelinson/sourceplane/orun/internal/statebackend/remote.go`
18. `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun-auth.md`
19. `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun-cloud.md`
20. `/Users/irinelinson/sourceplane/orun/website/docs/cli/orun-run.md`
21. `/Users/irinelinson/sourceplane/orun/website/docs/examples/remote-state-matrix.md`
22. `/Users/irinelinson/sourceplane/orun/website/docs/reference/configuration.md`
23. `/Users/irinelinson/sourceplane/orun/website/docs/reference/environment-variables.md`

# PR and CI Inspection

Inspect PR metadata:

```bash
gh pr view 83 --repo sourceplane/orun --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,commits,files,headRefOid
gh pr diff 83 --repo sourceplane/orun --name-only
```

Inspect CI logs:

```bash
gh run view 25456644764 --repo sourceplane/orun --log
```

Verify:

- CI is green for the current PR head.
- CI only ran plan/skipped matrix, so local checks are mandatory.
- No secrets/tokens appear in logs.
- No generated `.orun/`, coverage, website build output, or credential files are committed.

# Required Verification Work

## 1. Branch and Worktree Hygiene

In `sourceplane/orun`:

```bash
cd /Users/irinelinson/sourceplane/orun
git fetch origin main feat/cli-auth-remote-state
git switch feat/cli-auth-remote-state
git status --short --branch
```

Use a separate worktree if local state is dirty. Do not use destructive commands in the shared worktree.

In `sourceplane/orun-backend`, preserve the implementer report and any verifier/proposal files. Do not accidentally mix unrelated untracked files into implementation PR #83.

## 2. Auth Command Review

Verify these commands exist, are registered in help, and have sensible flag validation:

```bash
go run ./cmd/orun auth --help
go run ./cmd/orun auth login --help
go run ./cmd/orun auth status --help
go run ./cmd/orun auth logout --help
go run ./cmd/orun auth token --help
go run ./cmd/orun cloud --help
go run ./cmd/orun cloud link --help
```

Review behavior:

- `orun auth login` starts a loopback listener on localhost/127.0.0.1, opens the browser, validates callback state/nonce, stores Orun credentials, and stops cleanly.
- `orun auth login --device` calls Task 0010 device endpoints, displays user code and verification URL, polls with interval handling, and stores credentials.
- `orun auth status` shows GitHub login, backend URL, access-token expiry, and repo link status without printing tokens.
- `orun auth logout` revokes refresh token when possible and removes local credentials even when network revoke fails in a controlled way.
- `orun auth token --audience orun-backend` prints a token only when explicitly requested and refreshes first if needed.
- Errors are actionable for headless/non-interactive terminals.

## 3. Credential Storage Review

Verify:

- OS credential store/keychain is preferred where available.
- File fallback is `~/.orun/credentials.json` with `0600` permissions.
- Non-secret config is stored separately, for example `~/.orun/config.yaml`.
- Stored fields are Orun access/refresh tokens and metadata only.
- GitHub OAuth access tokens and GitHub PATs are never stored.
- Token-bearing files are not written with broad permissions.
- Tests do not write into the real home directory unless isolated through temp env.
- The macOS `security` CLI path has safe fallback on Linux/CI and does not make Linux unusable.

## 4. Remote-State Auth Resolution Review

Task 0011 required this order:

1. GitHub Actions: GitHub OIDC
2. Outside GitHub Actions: stored Orun CLI access token
3. Expired local token: refresh with Orun refresh token
4. Missing interactive login: prompt/start login
5. Missing non-interactive login: fail with `orun auth login --device` or explicit `ORUN_TOKEN`
6. `ORUN_TOKEN`: explicit short-lived Orun machine-token fallback, not GitHub PAT path

The implementer report says:

```text
1. GitHub Actions OIDC
2. explicit ORUN_TOKEN fallback
3. stored Orun CLI session credentials outside GitHub Actions
```

This may be a spec drift. Verify the actual implementation in `internal/remotestate/auth.go` and docs.

PASS only if:

- The behavior is safe and intentional, and docs clearly explain precedence; or
- A proposal file exists under `/Users/irinelinson/sourceplane/orun-backend/ai/proposals/` explaining why `ORUN_TOKEN` should precede stored CLI credentials.

Fail or request a fix if `ORUN_TOKEN` silently overrides a valid local human session in normal interactive local use without clear docs and rationale.

Also verify:

- GitHub Actions OIDC behavior is unchanged.
- Local `orun run --remote-state` uses CLI session credentials outside GHA.
- Expired access tokens refresh automatically through `/v1/auth/cli/token`.
- `status --remote-state` and `logs --remote-state` use the same backend URL/auth resolution.
- Backend URL precedence remains: flag, env, intent, local config.

## 5. `orun cloud link` Review

Verify:

- Detects GitHub remote robustly for common SSH and HTTPS remote URLs.
- Does not require or store a GitHub PAT.
- If already linked in backend, persists local namespace/repo linkage safely.
- If not linked, fails with a clear remediation path.
- Does not claim full repo-link creation if backend support is missing.
- Local repo link data is non-secret and can be removed/updated.

The implementer report notes a real remaining gap:

```text
Backend POST /v1/accounts/repos still requires X-GitHub-Access-Token, so the CLI cannot create a new backend repo link without exposing GitHub tokens.
```

Task process requires a proposal for this scope/API gap. Verify that a proposal file exists under `/Users/irinelinson/sourceplane/orun-backend/ai/proposals/`, or create/request one before PASS.

## 6. Default Local Mode Regression Review

Verify:

- `orun run` without `--remote-state` still uses local filesystem state and does not require login.
- Default `orun status` and `orun logs` remain local unless remote-state activation is explicit or configured.
- Existing plan/run/job ID behavior remains compatible with current `main`.
- No unexpected backend calls happen in default local mode.

Use tests and/or a small fixture smoke if practical.

## 7. Docs Review

Verify docs are accurate:

- `website/docs/cli/orun-auth.md`
- `website/docs/cli/orun-cloud.md`
- `website/docs/cli/orun-run.md`
- `website/docs/cli/orun-status.md`
- `website/docs/cli/orun-logs.md`
- `website/docs/reference/configuration.md`
- `website/docs/reference/environment-variables.md`
- `website/docs/examples/remote-state-matrix.md`

Docs must:

- explain local remote-state login
- explain device login for headless use
- explain auth status/logout/token
- explain `orun cloud link`
- explain backend URL resolution
- explain auth resolution order
- avoid presenting GitHub PATs as the normal path
- accurately describe the current repo-link creation limitation

## 8. Optional Live Smoke

If safe and credentials are available, run a contained live smoke against `https://orun-api.sourceplane.ai` using a temp home:

```bash
tmp_home="$(mktemp -d)"
HOME="$tmp_home" go run ./cmd/orun auth status --backend-url https://orun-api.sourceplane.ai
HOME="$tmp_home" go run ./cmd/orun auth login --device --backend-url https://orun-api.sourceplane.ai
HOME="$tmp_home" go run ./cmd/orun auth token --audience orun-backend --backend-url https://orun-api.sourceplane.ai
HOME="$tmp_home" go run ./cmd/orun auth logout --backend-url https://orun-api.sourceplane.ai
```

Do not print tokens in the report. Redact token output if captured.

If manual GitHub authorization is not appropriate, skip the full login and record that. Still run non-token help/status/error-path checks.

# Required Local Checks

In `sourceplane/orun`:

```bash
go test ./...
go test -race ./internal/runner ./cmd/orun ./internal/state ./internal/statebackend ./internal/remotestate
go vet ./...
git diff --check
```

Also run targeted tests:

```bash
go test ./internal/cliauth ./internal/remotestate ./cmd/orun -run 'Auth|Credential|Token|Cloud|Remote' -count=1 -v
```

If website docs have a build/test command in repo conventions, run it. If not, state that no docs build command exists.

# Acceptance Criteria

PR #83 can PASS only when:

1. Auth commands are registered and covered by tests.
2. Browser loopback and device flows match Task 0010 backend contracts.
3. Credential storage is safe and cross-platform enough.
4. Local remote-state auth uses Orun CLI session credentials.
5. Expired local access tokens refresh automatically.
6. GitHub Actions OIDC remote-state behavior is unchanged.
7. Default `orun run` local mode is not changed.
8. `ORUN_TOKEN` precedence is safe, documented, and proposal-backed if it differs from spec.
9. `orun cloud link` limitation has a proposal or is otherwise fixed.
10. Docs are accurate and avoid GitHub PATs as the normal path.
11. Local Go tests, race tests, vet, and diff checks pass.
12. Implementer and verifier reports are preserved in `orun-backend`.

# When Done Report

Write:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0011-verifier.md
```

Use this structure:

```md
# Task 0011 Verifier Report

## Result

PASS or FAIL

## PR

## Checks

## CI Log Review

## Auth Command Review

## Credential Storage Review

## Remote-State Auth Resolution Review

## Cloud Link Review

## Default Local Mode Regression Review

## Docs Review

## Optional Live Smoke

## Issues

## Risk Notes

## Spec Proposals

## Merge / Sync Actions

## Recommended Next Move
```

If PASS, include:

- PR #83 merge method and merge commit
- local `sourceplane/orun/main` sync evidence
- backend bookkeeping PR number and merge commit, if created
- accepted residual risks
- recommendation to proceed to Task 0012

If FAIL, include:

- numbered blockers
- exact files/lines or PR diff areas where possible
- failed commands/checks
- whether each failure is auth, credential storage, token precedence, cloud link, docs, tests, CI, or spec drift
- recommended Task 0011.1 remediation scope
