# Task 0012 Verifier

# Agent

Verifier

# Current Repo Context

Task 0012 implementation is complete and open for verification.

Primary implementation repo:

```text
/Users/irinelinson/sourceplane/orun
```

Planning/spec/bookkeeping repo:

```text
/Users/irinelinson/sourceplane/orun-backend
```

Task 0011 prerequisite is complete:

- `sourceplane/orun` PR #83 merged.
- CLI auth commands are available on `main`.
- Local Orun CLI sessions can be used for remote-state auth.
- Live backend origin: `https://orun-api.sourceplane.ai`.
- Accepted Task 0011 residuals:
  - `ORUN_TOKEN` precedence before stored CLI credentials is intentional and documented.
  - `orun cloud link` can only persist already-linked repos until backend repo-link creation exists.

Open PR to verify:

- Repo: `sourceplane/orun`
- PR: #84
- URL: `https://github.com/sourceplane/orun/pull/84`
- Title: `feat: add local remote-state conformance harness`
- Branch: `feat/local-remote-state-harness`
- Base: `main`
- Head SHA: `ca9e3eaaa6ebf91d21aab9c513445b8622df1c7f`
- Merge state at verifier prompt creation: `CLEAN`
- CI runs at verifier prompt creation:
  - CI: `https://github.com/sourceplane/orun/actions/runs/25473716640`
  - remote-state-conformance: `https://github.com/sourceplane/orun/actions/runs/25473716659`
- CI surface at verifier prompt creation:
  - `Orun Plan`: success
  - `Harness dry-run guard`: success
  - `Compile plan`: skipped
  - `Run: ${{ matrix.job }}`: skipped
  - `Env fanout: ${{ matrix.env_name }}`: skipped
  - `Verify remote status and logs`: skipped

Important: PR CI has not run live remote-state conformance. It only proves the dry-run guard. Local verification must inspect the implementation and run the required checks. If live CLI auth and repo link are available, run the harness against the live backend.

Open `sourceplane/orun` PRs that are not Task 0012:

- PR #70: `test: verify dep-wait fail-fast fix (v1.12.12)`
- PR #68: `Test workflow`

Do not merge or modify those as part of Task 0012 unless the user explicitly redirects.

Local implementer report:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0012-implementer.md
```

At verifier prompt creation, this report exists locally in `orun-backend` and may be untracked. Preserve it in verifier bookkeeping.

# Objective

Verify PR #84 against Task 0012.

Task 0012 is complete only if `sourceplane/orun` has a fast local remote-state conformance harness that lets developers verify the same backend coordination semantics from a laptop that GitHub Actions runners use in CI.

Verification must confirm:

1. The harness requires local Orun CLI auth and defaults to `https://orun-api.sourceplane.ai`.
2. The harness compiles or reuses a single plan and shares one `ORUN_EXEC_ID`.
3. It launches multiple local `orun run --remote-state --job ...` processes.
4. It includes a duplicate job target and fails if both processes execute the same job.
5. It includes a dependency-wait case that exercises backend `/runnable` behavior, not empty local state.
6. It verifies final remote status through `orun status --remote-state --json`.
7. It fetches remote logs through `orun logs --remote-state`.
8. Dry-run or mocked checks prove the harness command construction without credentials.
9. GitHub Actions conformance workflow remains intact and does not depend on nonexistent CLI commands.
10. Docs are accurate, copyable, and do not present GitHub PATs as the normal local auth path.
11. Required tests pass locally.
12. Any spec/scope drift has a proposal file under `orun-backend/ai/proposals/`.

If PASS:

- Merge PR #84 in `sourceplane/orun`.
- Checkout `/Users/irinelinson/sourceplane/orun/main` and fast-forward pull from `origin/main`.
- Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0012-verifier.md`.
- Update `/Users/irinelinson/sourceplane/orun-backend/ai/state.json`:
  - add `12` to `completed`
  - set `current_task` to `13`
  - set `next_focus` to the next Orun CLI or deployment task chosen from current repo reality
  - keep `repo_health` green unless residual live-conformance risk should make it yellow
  - set `last_verified` to the verification date
  - add concise notes for PR #84, live or dry-run evidence, and any accepted residual risk
- Ensure `ai/reports/task-0012-implementer.md`, `ai/reports/task-0012-verifier.md`, and any required proposal files are committed through a small `sourceplane/orun-backend` bookkeeping PR, merged, and local `main` fast-forwarded.

If FAIL:

- Do not merge PR #84.
- Write `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0012-verifier.md` with concrete blockers.
- Leave clear PR feedback on PR #84.
- Recommend Task 0012.1 remediation scope.

# Read First

Read these files in `sourceplane/orun-backend`:

1. `/Users/irinelinson/sourceplane/orun-backend/ai/tasks/task-0012.md`
2. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0012-implementer.md`
3. `/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0011-verifier.md`
4. `/Users/irinelinson/sourceplane/orun-backend/spec/09-cli-integration.md`
5. `/Users/irinelinson/sourceplane/orun-backend/agents/orchestrator.md`

Read these files in `sourceplane/orun`:

1. `/Users/irinelinson/sourceplane/orun/examples/remote-state-matrix/run-local-harness.sh`
2. `/Users/irinelinson/sourceplane/orun/examples/remote-state-matrix/test/dry-run-guard.sh`
3. `/Users/irinelinson/sourceplane/orun/examples/remote-state-matrix/test/harness_test.go`
4. `/Users/irinelinson/sourceplane/orun/examples/remote-state-matrix/intent.yaml`
5. `/Users/irinelinson/sourceplane/orun/examples/github-actions/remote-state-matrix.yml`
6. `/Users/irinelinson/sourceplane/orun/.github/workflows/remote-state-conformance.yml`
7. `/Users/irinelinson/sourceplane/orun/website/docs/examples/remote-state-matrix.md`
8. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_auth.go`
9. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_run.go`
10. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_status.go`
11. `/Users/irinelinson/sourceplane/orun/cmd/orun/command_logs.go`
12. `/Users/irinelinson/sourceplane/orun/internal/remotestate/auth.go`
13. `/Users/irinelinson/sourceplane/orun/internal/remotestate/client.go`

# PR and CI Inspection

Inspect PR metadata:

```bash
gh pr view 84 --repo sourceplane/orun --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,commits,files,headRefOid
gh pr diff 84 --repo sourceplane/orun --name-only
```

Inspect CI logs:

```bash
gh run view 25473716640 --repo sourceplane/orun --log
gh run view 25473716659 --repo sourceplane/orun --log
```

Verify:

- CI is green for the current PR head.
- The remote-state-conformance workflow only ran the dry-run guard unless manually triggered.
- Logs do not leak tokens, repo secrets, device codes, access tokens, refresh tokens, or backend credentials.
- No generated `.orun/`, harness logs, temp status files, website build output, or credential files are committed.

# Required Verification Work

## 1. Branch and Worktree Hygiene

In `sourceplane/orun`:

```bash
cd /Users/irinelinson/sourceplane/orun
git fetch origin main feat/local-remote-state-harness
git switch feat/local-remote-state-harness
git status --short --branch
```

Use a separate worktree if local state is dirty. Do not use destructive commands in the shared worktree.

In `sourceplane/orun-backend`, preserve the implementer report and any verifier/proposal files. Do not accidentally mix unrelated untracked files into implementation PR #84.

## 2. Harness Script Review

Review `examples/remote-state-matrix/run-local-harness.sh`.

Verify:

- Uses bash strict mode and fails loudly.
- Has cleanup/traps for temp files and background processes.
- Defaults `ORUN_BACKEND_URL` to `https://orun-api.sourceplane.ai` and allows override.
- Requires `orun auth status` before live execution.
- Does not require Cloudflare deploy credentials.
- Does not require or document GitHub PATs as the normal path.
- Compiles or reuses one plan consistently.
- Uses a single shared `ORUN_EXEC_ID` across all local job processes.
- Exports remote-state env needed by the CLI, including `ORUN_REMOTE_STATE` if that is the local convention.
- Launches at least two processes for the same job ID.
- Launches at least one dependent job that cannot run until the duplicate-target job succeeds.
- Waits on all background processes and returns nonzero on any unexpected failure.
- Retrieves status with `orun status --remote-state --json`.
- Retrieves logs with `orun logs --remote-state --job ...`.
- Handles missing `jq`, missing `orun`, auth failures, expired sessions, and missing repo linkage with actionable errors.
- Never commits generated `.orun/` or temporary harness artifacts.

Pay special attention to duplicate-claim detection.

The implementer report says the harness counts `"=== SMOKE: foundation"` across both foundation logs and fails if the count is greater than `2`. Verify this threshold proves exactly what the task requires. If one real execution can emit that marker more than once, or if two executions can still pass with count `2`, require a fix. The verifier should prefer an assertion that unambiguously proves the duplicate process did not execute the job body.

## 3. Dry-Run Guard Review

Review:

```text
examples/remote-state-matrix/test/dry-run-guard.sh
examples/remote-state-matrix/test/harness_test.go
```

Run:

```bash
cd /Users/irinelinson/sourceplane/orun
bash -n examples/remote-state-matrix/run-local-harness.sh
bash -n examples/remote-state-matrix/test/dry-run-guard.sh
examples/remote-state-matrix/test/dry-run-guard.sh
ORUN_DRY_RUN=1 examples/remote-state-matrix/run-local-harness.sh
go test ./examples/remote-state-matrix/test -count=1 -v
```

Verify:

- Dry-run mode makes no real backend calls.
- Dry-run output includes the intended plan, shared exec ID, duplicate job, dependency-wait job, status check, and logs check.
- The Go test wrapper is included in `go test ./...` and isolates environment state.
- The guard is not so loose that it would pass if the harness stopped checking duplicate claims, dependency waiting, status, or logs.

## 4. Workflow Review

Review `.github/workflows/remote-state-conformance.yml`.

Verify:

- Existing GitHub Actions remote-state matrix behavior remains intact.
- The always-on job is safe for PRs and does not require live credentials.
- Live conformance jobs are intentionally gated on `workflow_dispatch` or an explicit repo variable.
- `permissions: id-token: write` is present where OIDC is needed.
- The workflow uses one shared execution ID for all matrix jobs in a conformance run.
- Status/log verification happens after matrix jobs.
- Artifacts/logs are uploaded without leaking tokens.

The implementer report calls out a possible gap: the workflow uses `orun get jobs --plan <id> --all -o json`. Verify that command exists and has the expected behavior.

Run or inspect:

```bash
cd /Users/irinelinson/sourceplane/orun
go run ./cmd/orun get --help
go run ./cmd/orun get jobs --help
```

If `orun get jobs --plan <id> --all -o json` does not exist or the flags differ, PR #84 must FAIL unless the workflow is fixed before merge.

## 5. Live Harness Check

If a valid local Orun CLI session and linked repo are available, run the harness against the live backend.

Start with safe status checks:

```bash
cd /Users/irinelinson/sourceplane/orun
go run ./cmd/orun auth status --backend-url https://orun-api.sourceplane.ai
```

If authenticated and linked, run:

```bash
cd /Users/irinelinson/sourceplane/orun/examples/remote-state-matrix
ORUN_BACKEND_URL=https://orun-api.sourceplane.ai ./run-local-harness.sh
```

Verify live output proves:

- Only one duplicate claimant executed the duplicate job body.
- The dependent job waited until the prerequisite was remotely runnable.
- Final remote status shows expected jobs succeeded.
- Remote logs can be fetched and are non-empty.

If live auth or repo linking is unavailable:

- Do not pretend live conformance was verified.
- Run the dry-run guard and all local checks.
- Decide whether the task can still PASS under the Task 0012 allowance for mocked/dry-run guard.
- PASS is acceptable only if the implementation is structurally correct, docs/report clearly state live conformance was not run, and the remaining risk is recorded in the verifier report and state notes.
- FAIL if the harness itself is brittle, the workflow is broken, or the report/docs overclaim live backend proof.

## 6. Docs Review

Review `website/docs/examples/remote-state-matrix.md`.

Verify docs explain:

- Why local remote-state exists.
- How it differs from default local filesystem state.
- How local CLI auth differs from GitHub Actions OIDC.
- How to run `orun auth login` or `orun auth login --device`.
- How to run the local harness.
- How to override `ORUN_BACKEND_URL`.
- How to troubleshoot missing repo access, expired tokens, backend URL mismatch, revoked refresh tokens, dependency wait timeouts, and missing logs.
- Why GitHub PATs are not the normal path.
- That dry-run mode verifies command construction only, not live backend coordination.

Fail if docs imply the live backend behavior was verified when only dry-run checks were run.

## 7. Required Local Checks

Run in `sourceplane/orun`:

```bash
cd /Users/irinelinson/sourceplane/orun
go test ./...
go vet ./...
git diff --check
```

If checks fail, inspect whether the failure is caused by PR #84. Do not merge with unresolved task-related failures.

# Acceptance Criteria

PR #84 can PASS only if:

1. The local harness exists under `examples/remote-state-matrix/`.
2. The harness can be run by a developer after `orun auth login`.
3. The harness uses the live backend by default and supports override.
4. Duplicate claim detection is robust enough to fail if two local processes execute the same job.
5. Dependency waiting exercises remote `/runnable` behavior.
6. Status and logs are checked through separate CLI commands.
7. Dry-run or mocked guard covers command construction without credentials.
8. The GitHub Actions conformance workflow is syntactically and semantically valid, including all CLI commands it calls.
9. Docs are accurate, copyable, and safe.
10. Required checks pass.
11. Any meaningful spec drift has an `ai/proposals/` proposal.

# Report Format

Write:

```text
/Users/irinelinson/sourceplane/orun-backend/ai/reports/task-0012-verifier.md
```

Use this structure:

```markdown
# Task 0012 Verifier Report

Result: PASS|FAIL

## Summary

## PR

## CI and Workflow Logs

## Harness Review

## Live or Dry-Run Evidence

## Checks Run

## Issues

## Risk Notes

## Spec Proposals

## Recommended Next Move
```

For PASS, include the merge commit and local sync status.

For FAIL, include exact blockers, file paths, line references where useful, and the recommended Task 0012.1 scope.
