# Task 0002 Verification

# Agent
Verifier

# Current Repo Context
Task 0002 implemented the canonical `@orun/types` package and has already been merged.

GitHub PR to verify:

- PR: #5
- URL: `https://github.com/sourceplane/orun-backend/pull/5`
- Title: `feat: implement shared types package`
- Branch: `codex/task-0002-types-package`
- Base: `main`
- State at prompt creation: `MERGED`
- Merge commit on `origin/main`: `a06a6e50fcc9628da5897d3ab06967ce7a1f53de`
- Final PR head SHA before merge: `9805eb3d4c37ed868e361a58d00c7ac060dae600`

CI runs to inspect:

- Final PR run: `25224381600` - success
- Post-merge `main` push run: `25224426145` - success
- Earlier Task 0002 runs include failures. Inspect them only as needed to confirm that final commits fixed the failure mode.

Important local state:

- Local `main` may be divergent from `origin/main`; do not reset it destructively.
- For verification, create a fresh verification branch from `origin/main` or use a worktree. Do not verify against stale local `main`.
- Local generated `.orun/` and `.workspace/` directories may exist; on `origin/main` they should be ignored.

Important final-state discrepancies to verify:

- The implementer report and PR body mention `kiox.yaml` v1.7.0, but `origin/main:kiox.yaml` currently pins `ghcr.io/sourceplane/orun:v1.11.0`.
- `origin/main:kiox.lock` currently pins `ghcr.io/sourceplane/orun:v1.10.1`.
- The implementer report and PR body mention `kiox -- orun run --gha`, but `origin/main:.github/workflows/workflow.yml` currently uses `kiox -- orun run --changed`.
- Treat these as verification risks. Determine whether they are intentional and safe, or blockers that require a follow-up fix.

# Objective
Verify Task 0002 after merge against the task prompt, specs, implementer report, final merged code, local quality gates, local kiox/orun behavior, and GitHub Actions logs.

If PASS, write the verifier report, update state to mark Task 0002 complete, open a small verification-report PR, wait for CI, merge it, and leave local checkout ready for Task 0003.

If FAIL, do not mark Task 0002 complete. Write the verifier report with blockers and open or recommend a stabilization PR before Task 0003 begins.

# Read First
Read these files from `origin/main` after checking out a fresh verification branch:

1. `ai/tasks/task-0002.md`
2. `ai/reports/task-0002-implementer.md`
3. `ai/reports/task-0001-verifier.md`
4. `agents/orchestrator.md`
5. `SCHEDULE.md`
6. `spec/00-constitution.md`
7. `spec/01-monorepo-structure.md`
8. `spec/03-types-package.md`
9. `spec/07-storage.md` section "Shared Path Utilities"

Inspect PR #5 metadata and final diff:

```bash
gh pr view 5 --repo sourceplane/orun-backend --json number,title,url,state,mergedAt,headRefName,baseRefName,mergeCommit,body,commits,files,reviews,statusCheckRollup
gh pr diff 5 --repo sourceplane/orun-backend --stat
gh pr diff 5 --repo sourceplane/orun-backend --name-only
```

# Fresh Checkout Setup
Use a fresh branch from `origin/main` so verification runs on the merged code, not stale local `main`.

Recommended:

```bash
git fetch origin main
git switch -c codex/task-0002-verification-report origin/main
git status --short --branch
```

If that branch already exists, use a unique suffix. Do not delete or reset branches you did not create.

# Required Verification Work
Verify every Task 0002 acceptance criterion:

1. `packages/types/src/index.ts` exports every type/interface listed in `spec/03-types-package.md`.
2. `packages/types/src/paths.ts` exists and implements the exact path formats from `spec/07-storage.md`.
3. `packages/types/package.json` exports both `@orun/types` and `@orun/types/paths`.
4. Placeholder scaffold status literals are corrected to the spec values:
   - `RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled"`
   - `JobStatus = "pending" | "running" | "success" | "failed" | "skipped"`
5. Path utility tests exist and pass.
6. Existing scaffold packages still typecheck, build, and test.
7. No coordinator, storage, auth, rate-limiting, Worker routing, or migration behavior was implemented.
8. Scaffold hygiene changes are intentional and safe.
9. Local kiox/orun validation is attempted using `/Users/irinelinson/.local/bin/kiox` and results are documented.
10. Final PR CI and post-merge main CI logs prove the expected commands ran successfully.

# Local Commands To Run
Run:

```bash
pnpm install
pnpm exec turbo run typecheck
pnpm exec turbo run build
pnpm exec turbo run test
pnpm exec turbo run lint
pnpm --filter @orun/types test
cd apps/worker && pnpm exec wrangler deploy --dry-run && cd ../..
```

Run focused inspection commands:

```bash
rg -n "\\bany\\b" packages/types/src
rg -n "queued|failure|completed|failed|success|skipped" packages/types/src/index.ts
node -e "import('./packages/types/src/paths.ts').then(m => console.log(m.runLogPath('123','run-1','job-a'), m.planPath('123','abc'), m.coordinatorKey('123','run-1')))"
```

If the direct Node import of TypeScript source is not supported by the local Node runtime, do not treat that alone as a failure. Use the Vitest path tests and TypeScript checks as the authority.

Run local kiox/orun validation:

```bash
/Users/irinelinson/.local/bin/kiox -- orun run --help
/Users/irinelinson/.local/bin/kiox -- orun plan
/Users/irinelinson/.local/bin/kiox -- orun plan --view dag
```

If `kiox -- orun plan` hangs at `Loading compositions...`, interrupt after a reasonable timeout, capture the last output, and determine whether this is an environmental registry/network issue or a repo configuration issue. A repo-caused kiox failure is a blocker. An environmental pull hang may be a risk note if CI proves the same path works.

Run `orun run` locally only if it is safe:

```bash
/Users/irinelinson/.local/bin/kiox -- orun run --changed
```

Do not perform a live production deploy from local verification. If the command requires secrets or would deploy live resources, stop and document why.

# CI Log Verification
Do not trust green checks by status alone. Inspect logs.

Inspect final PR run:

```bash
gh run view 25224381600 --repo sourceplane/orun-backend --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25224381600 --repo sourceplane/orun-backend --log
```

Inspect post-merge main run:

```bash
gh run view 25224426145 --repo sourceplane/orun-backend --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25224426145 --repo sourceplane/orun-backend --log
```

Confirm in logs:

- `sourceplane/kiox-action@v2.1.2` initialized the workspace.
- The workflow used the expected `kiox.yaml` provider version.
- The workflow used `kiox.lock` consistently, or regenerated/resolved providers in a clearly safe way.
- The PR review path ran the changed-scope plan expected by `.github/workflows/workflow.yml`.
- The build/deploy path ran the expected `kiox -- orun run --changed` command.
- No live production deploy occurred unexpectedly.
- Typecheck/build/test/lint jobs for the changed components succeeded.
- Earlier failures in the Task 0002 PR were fixed by later commits and are not still present on the merged head.

# Code Review Focus
Inspect the actual merged files, not only the report.

Core type contract:

- `Namespace` uses `namespaceId` and `namespaceSlug`.
- `Run`, `Job`, and `Plan` exactly match `spec/03-types-package.md`.
- API payloads exactly match the spec.
- `OIDCClaims` and `SessionClaims` exactly match the spec.
- `ErrorCode` and `ApiError` exactly match the standardized error envelope.
- `Env` uses Cloudflare Worker binding types and includes optional `ORUN_DEPLOY_TOKEN`.
- No `any` is introduced in `packages/types/src`.
- `Record<string, unknown>` is used for open-ended step inputs.

Path utilities:

- `runLogPath(namespaceId, runId, jobId)` returns `{namespaceId}/runs/{runId}/logs/{jobId}.log`.
- `planPath(namespaceId, checksum)` returns `{namespaceId}/plans/{checksum}.json`.
- `coordinatorKey(namespaceId, runId)` returns `{namespaceId}:{runId}`.
- Tests cover all three deterministic examples from Task 0002.

Package boundary:

- `@orun/types` remains dependency-light.
- It does not import coordinator/storage/worker/client packages.
- `@cloudflare/workers-types` placement is justified for downstream `Env` consumers.
- `@orun/types/paths` is exported in a way that TypeScript consumers can import.

Scaffold hygiene:

- `.orun/` and `.workspace/` are ignored.
- `kiox.lock` is either consistent with `kiox.yaml` or a fix is required.
- `.github/workflows/workflow.yml` is consistent with the current orun CLI flags.
- If `--gha` is supported but absent, determine whether GitHub Actions mode is now auto-detected or whether this is a blocker.
- If `--execute` is unsupported, confirm the implementer was right to avoid it.
- The current `kiox.yaml` version and `kiox.lock` version mismatch must be explained or fixed.

# Pass / Fail Rules
PASS only if:

- The merged `@orun/types` contract matches the spec.
- All local pnpm/turbo/type tests pass.
- Path utility tests pass and are meaningful.
- No out-of-scope domain logic was added.
- CI logs for final PR and post-merge main runs confirm expected behavior.
- `kiox.yaml`, `kiox.lock`, and workflow command choices are consistent or safely explained.
- Any verifier report/state update is committed through a small PR and CI is green.

FAIL if:

- Any required type/export is missing or materially different from the spec.
- Status literals remain scaffold/stale values.
- `@orun/types/paths` cannot be imported by consumers.
- Local or CI quality gates fail for repo-caused reasons.
- CI is green but logs show expected commands did not actually run.
- `kiox.yaml` and `kiox.lock` are inconsistent in a way that can break reproducibility.
- Workflow command changes can skip required validation/deploy safety behavior.

# When Done Report
Write:

```text
ai/reports/task-0002-verifier.md
```

Use this structure:

```markdown
# Task 0002 Verifier Report

## Result
PASS|FAIL

## Checks

## CI Logs Reviewed

## Code Review Notes

## Issues

## Risk Notes

## Recommended Next Move
```

Include exact commands run and pass/fail status. Include GitHub workflow run IDs and relevant conclusions.

# If PASS
Because PR #5 is already merged, complete this sequence:

1. Update `ai/state.json`:
   - `current_task`: `3`
   - `completed`: `[1, 2]`
   - `repo_health`: `"green"`
   - `next_focus`: `"task-0003-coordinator"`
   - add notes that Task 0002 was verified PASS and whether the kiox lock/version state is acceptable.
2. Commit `ai/reports/task-0002-verifier.md` and the state update on the verification branch.
3. Push the verification branch.
4. Open a PR targeting `main`.
5. Wait for CI.
6. Inspect CI logs for that PR.
7. Merge the verification-report PR.
8. Checkout/sync local `main` to the merged remote state. If local `main` is divergent, do not destroy local commits without explicit approval; use a fresh branch/worktree for subsequent task work if needed.

# If FAIL
Do not mark Task 0002 complete.

Write `ai/reports/task-0002-verifier.md` with `Result: FAIL`, then open a stabilization PR or leave a clear GitHub issue/PR comment with:

- Blocking issue(s)
- Exact failing command(s), file(s), or CI log lines
- Minimal required fix
- Whether Task 0003 must wait
