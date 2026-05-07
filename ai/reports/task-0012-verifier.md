# Task 0012 Verifier Report

Result: FAIL

## Summary

PR #84 adds the expected local harness, dry-run guard, workflow, and docs, and the local Go quality gates pass. It still does not satisfy Task 0012 because the duplicate-claim proof is not unambiguous, the harness does not provide the required actionable prerequisite/repo-link failure handling, the workflow's final assertion is too weak, and the docs omit the dry-run fallback path details.

## PR

- Repo: `sourceplane/orun`
- PR: #84
- Title: `feat: add local remote-state conformance harness`
- Branch: `feat/local-remote-state-harness` -> `main`
- Head SHA: `ca9e3eaaa6ebf91d21aab9c513445b8622df1c7f`
- Merge state at verification: `CLEAN`
- Verified: 2026-05-07

## CI and Workflow Logs

- `gh pr view 84 --repo sourceplane/orun --json ...` shows the current head SHA matches the verifier prompt and both visible checks are green.
- CI run `25473716640` is green for the current PR head.
- `remote-state-conformance` run `25473716659` only ran `Harness dry-run guard`; `Compile plan`, `Run: ${{ matrix.job }}`, `Env fanout: ${{ matrix.env_name }}`, and `Verify remote status and logs` were skipped as gated.
- Inspected logs did not expose unmasked backend tokens, access tokens, refresh tokens, device codes, or credential files.
- `go run ./cmd/orun get --help` and `go run ./cmd/orun get jobs --help` confirm that `orun get jobs --plan <id> --all -o json` exists and matches the workflow command shape.

## Harness Review

- `examples/remote-state-matrix/run-local-harness.sh` uses `set -euo pipefail`, defaults `ORUN_BACKEND_URL` to `https://orun-api.sourceplane.ai`, exports a shared `ORUN_EXEC_ID`, launches duplicate `foundation@dev.smoke` runners plus dependent `api@dev.smoke`, and performs separate `status` and `logs` commands.
- Blocker: `examples/remote-state-matrix/run-local-harness.sh:149-163` uses a `SMOKE_COUNT > 2` heuristic based on `=== SMOKE: foundation` markers. One legitimate execution already emits that marker twice, so this is not the unambiguous duplicate-claim proof required by the verifier prompt.
- Blocker: `examples/remote-state-matrix/run-local-harness.sh:108-109` only traps temp-dir cleanup and does not kill background runners on interrupt or early exit.
- Blocker: `examples/remote-state-matrix/run-local-harness.sh:76-97` and `114-205` do not add explicit actionable preflight checks for missing `orun`, missing `jq`, or missing repo linkage before the concurrent run starts.

## Live or Dry-Run Evidence

- `go run ./cmd/orun auth status --backend-url https://orun-api.sourceplane.ai` failed with `not logged in; run \`orun auth login\` or \`orun auth login --device\``, so live backend verification was not possible from this machine.
- `examples/remote-state-matrix/test/dry-run-guard.sh` passed locally.
- `ORUN_DRY_RUN=1 examples/remote-state-matrix/run-local-harness.sh` emitted the expected plan, shared exec ID, duplicate job, dependency-wait job, status check, and logs check command sequence.
- Dry-run evidence alone is not sufficient to PASS because the structural blockers above remain unresolved.

## Checks Run

- `gh pr view 84 --repo sourceplane/orun --json number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup,commits,files,headRefOid`
- `gh pr diff 84 --repo sourceplane/orun --name-only`
- `gh run view 25473716640 --repo sourceplane/orun --log`
- `gh run view 25473716659 --repo sourceplane/orun --log`
- `git fetch origin main feat/local-remote-state-harness`
- `git switch feat/local-remote-state-harness`
- `git status --short --branch`
- `bash -n examples/remote-state-matrix/run-local-harness.sh`
- `bash -n examples/remote-state-matrix/test/dry-run-guard.sh`
- `examples/remote-state-matrix/test/dry-run-guard.sh`
- `ORUN_DRY_RUN=1 examples/remote-state-matrix/run-local-harness.sh`
- `go test ./examples/remote-state-matrix/test -count=1 -v`
- `go run ./cmd/orun get --help`
- `go run ./cmd/orun get jobs --help`
- `go run ../../cmd/orun plan --name remote-state-e2e --all`
- `go run ../../cmd/orun get plans -o json`
- `go run ../../cmd/orun get jobs --plan latest --all -o json`
- `go test ./...`
- `go vet ./...`
- `git diff --check`

## Issues

1. `examples/remote-state-matrix/run-local-harness.sh:149-163`
The duplicate-claim assertion does not prove the required invariant. A single real execution already prints two matching foundation markers, so the current `> 2` threshold only suggests that a second full execution was not observed. Task 0012 requires a check that proves the duplicate process did not execute the job body.

2. `examples/remote-state-matrix/run-local-harness.sh:108-109`, `76-97`, `114-205`
The harness does not yet meet the required operational hardening bar. It lacks background-process cleanup on signal/early exit, explicit prerequisite checks for `orun` and `jq`, and a dedicated actionable repo-link failure path before launching concurrent runners.

3. `.github/workflows/remote-state-conformance.yml:245-260`
The workflow's final assertion only verifies that no jobs are in `failed` state. It does not assert that the expected conformance jobs reached `success`, so a stuck or still-pending remote-state regression could slip through while the final verification step still exits 0.

4. `website/docs/examples/remote-state-matrix.md:77-104`, `234-325`
The docs do not mention `ORUN_DRY_RUN=1` or explain that dry-run verifies command construction only, not live backend coordination. The same local-harness section also labels `orun cloud link` as optional even though missing repo linkage is a hard blocker for many local remote-state runs. The docs are not yet fully accurate/copyable for the fallback non-live path.

5. `examples/remote-state-matrix/test/dry-run-guard.sh:29-84`
The dry-run guard is too marker-based to be the sole non-live proof. It checks for strings in script output and file contents, but it would still pass if the duplicate/status/log assertion logic regressed while leaving the current marker text in place.

## Risk Notes

- Live remote-state conformance against `https://orun-api.sourceplane.ai` was not run because no valid local Orun CLI session is available on this machine.
- CI for PR #84 currently proves only the dry-run guard path; the live conformance workflow remains gated and was not exercised during verification.

## Spec Proposals

- None. The blockers are implementation/docs gaps within current Task 0012 scope.

## Recommended Next Move

Do not merge PR #84.

Recommended Task 0012.1 remediation scope:

1. Replace the duplicate-count heuristic with an assertion that proves only one claimant executed the duplicate job body.
2. Add explicit prerequisite and repo-link checks plus signal-safe cleanup for background runners.
3. Tighten the workflow and dry-run guard so they assert expected success states and critical harness logic, not just absence of failures or presence of marker strings.
4. Document `ORUN_DRY_RUN=1`, state clearly that dry-run is command-construction-only, and make repo linkage a real prerequisite instead of an optional hint.
5. Re-run the local checks and a live harness run after `orun auth login` and repo linkage are available.
