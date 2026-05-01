# Task 0001 Verification

# Agent
Verifier

# Current Repo Context
Task 0001 implemented the initial `orun-backend` monorepo scaffold.

Relevant local files:

- Task prompt: `ai/tasks/task-0001.md`
- Implementer report: `ai/reports/task-0001-implementer.md`
- Orchestrator state: `ai/state.json`
- Specs: `spec/00-constitution.md`, `spec/01-monorepo-structure.md`, `spec/02-devops.md`

GitHub PR to verify:

- PR: #4
- URL: `https://github.com/sourceplane/orun-backend/pull/4`
- Branch: `codex/task-0001-monorepo-scaffold`
- Base: `main`
- Current state at prompt creation: open draft, mergeable
- Surface CI at prompt creation: green
- Workflow run visible at prompt creation: `25208040053`
- Jobs seen at prompt creation:
  - `Review Plan`: success
  - `Build & Deploy`: success

The implementer reported that local `kiox -- orun plan` was not run because `kiox` was not found. The user has now clarified that kiox is installed at:

```text
/Users/irinelinson/.local/bin/kiox
```

Use that binary explicitly if `kiox` is not already on `PATH`.

# Objective
Verify Task 0001 end to end against the prompt, specs, implementer report, local quality gates, local kiox/orun behavior, and PR CI logs.

If the task passes, write the verifier report, ensure the report is included in the PR branch, re-check CI, merge PR #4, and checkout/sync local `main`.

If the task fails, do not merge. Write a verifier report with concrete blockers and leave a PR comment or review describing the failure.

# Read First
Read these before running checks:

1. `ai/tasks/task-0001.md`
2. `ai/reports/task-0001-implementer.md`
3. `agents/orchestrator.md`
4. `SCHEDULE.md`
5. `spec/00-constitution.md`
6. `spec/01-monorepo-structure.md`
7. `spec/02-devops.md`

Then inspect PR #4 metadata, file list, and diff:

```bash
gh pr view 4 --repo sourceplane/orun-backend --json number,title,url,state,isDraft,headRefName,baseRefName,mergeable,body,commits,files,reviews,statusCheckRollup
gh pr diff 4 --repo sourceplane/orun-backend --stat
gh pr diff 4 --repo sourceplane/orun-backend --name-only
```

# Required Verification Work
Verify all Task 0001 acceptance criteria:

1. Required directory and file structure exists.
2. `pnpm install` succeeds and `pnpm-lock.yaml` is committed.
3. `pnpm exec turbo run typecheck` succeeds.
4. `pnpm exec turbo run build` succeeds.
5. `pnpm exec turbo run test` succeeds.
6. `pnpm exec turbo run lint` succeeds, or lint deferral is intentional and clearly documented.
7. `apps/worker/wrangler.jsonc` contains the required bindings and vars:
   - `COORDINATOR`
   - `STORAGE`
   - `DB`
   - `GITHUB_JWKS_URL`
   - `GITHUB_OIDC_AUDIENCE`
8. `intent.yaml`, `kiox.yaml`, and every required `component.yaml` match the tectonic model.
9. `.github/workflows/workflow.yml` uses `sourceplane/kiox-action@v2.1.2` and runs the expected `kiox -- orun plan` and `kiox -- orun run --execute --gha` commands.
10. No real backend business logic was introduced.
11. PR #4 is mergeable and CI logs confirm expected behavior.

# Local Commands To Run
Start from a clean understanding of the worktree:

```bash
git status --short --branch
gh pr checkout 4 --repo sourceplane/orun-backend
git status --short --branch
```

Do not discard unrelated local changes. If generated `.orun/`, `.workspace/`, `kiox.lock`, or other local artifacts already exist before your checks, note them in the verifier report. Only delete generated files that you personally created during verification and that are clearly not meant to be committed.

Run the standard local quality gates:

```bash
pnpm install
pnpm exec turbo run typecheck
pnpm exec turbo run build
pnpm exec turbo run test
pnpm exec turbo run lint
```

Run Cloudflare Worker dry-run validation:

```bash
cd apps/worker
pnpm exec wrangler deploy --dry-run
cd ../..
```

Run local kiox/orun validation:

```bash
/Users/irinelinson/.local/bin/kiox -- orun plan
/Users/irinelinson/.local/bin/kiox -- orun plan --view dag
/Users/irinelinson/.local/bin/kiox -- orun run
```

If `kiox -- orun run` requires a flag to stay local/safe, inspect the CLI help and choose the safest non-production local execution mode. Do not perform a live Cloudflare production deploy from local verification. If the command cannot run without secrets or a live deploy, record the exact blocker and command output in the verifier report.

# CI Log Verification
Do not trust green checks by status alone. Inspect logs.

Recommended commands:

```bash
gh pr checks 4 --repo sourceplane/orun-backend --watch
gh run view 25208040053 --repo sourceplane/orun-backend --json databaseId,status,conclusion,headBranch,headSha,jobs
gh run view 25208040053 --repo sourceplane/orun-backend --log
```

If PR #4 has newer workflow runs, inspect the newest run for the PR head SHA instead of only run `25208040053`.

Confirm in the logs:

- `sourceplane/kiox-action@v2.1.2` initialized the workspace.
- PR review job ran `kiox -- orun plan`.
- Build/deploy job ran `kiox -- orun plan --view dag`.
- Build/deploy job ran `kiox -- orun run --execute --gha`.
- The PR path did not unexpectedly perform a live production deploy.
- There are no hidden failures, warnings that invalidate the scaffold, or skipped required steps.

# Code Review Focus
Inspect the actual files, not just generated output.

Check for:

- Package names and workspace layout match `spec/01-monorepo-structure.md`.
- `apps/worker/wrangler.jsonc` uses exact required binding names.
- Durable Object placeholder shape is minimal and future-replaceable.
- `packages/types` has only minimal placeholder types and does not prematurely implement Task 0002.
- No auth, storage, coordinator, rate limiting, account, or API business logic was added.
- Tectonic files are present and use the specified versions:
  - `ghcr.io/sourceplane/orun:v0.9.6`
  - `oci://ghcr.io/sourceplane/stack-tectonic:0.11.0`
  - `sourceplane/kiox-action@v2.1.2`
- Generated files are intentional. In particular, decide whether `kiox.lock` should be committed or ignored based on actual kiox/orun behavior and repo conventions.
- `.npmrc` content is valid and useful. It appears as a zero-line file in PR metadata, so verify whether it is empty and whether that is intentional.
- The README stale spec numbering is not made worse by this task.

# Pass / Fail Rules
PASS only if:

- All required acceptance criteria are met.
- Local quality gates pass, including kiox/orun validation or a clearly justified safe limitation.
- PR CI logs prove the expected kiox/orun workflow executed.
- Any generated verification report or required small follow-up is committed to the PR branch and CI is green after that commit.
- No production-grade blocker remains.

FAIL if:

- Required scaffold files are missing or materially wrong.
- CI is green but logs reveal expected commands did not actually run.
- Local `kiox -- orun plan` or local `kiox -- orun run` fails for a reason caused by the scaffold.
- The implementation added domain logic beyond Task 0001 scope.
- Required tectonic/orun delivery wiring is incomplete or inconsistent.
- You cannot determine whether a live deploy might occur unexpectedly from PR CI.

# When Done Report
Write:

```text
ai/reports/task-0001-verifier.md
```

Use this structure:

```markdown
# Task 0001 Verifier Report

## Result
PASS|FAIL

## Checks

## CI Logs Reviewed

## Issues

## Risk Notes

## Recommended Next Move
```

Include exact commands run and their pass/fail status. Include the GitHub workflow run ID(s) and the relevant log conclusions.

# If PASS
Complete this sequence:

1. Commit `ai/reports/task-0001-verifier.md` to the PR branch.
2. Push the PR branch.
3. Wait for CI on the new head SHA.
4. Re-inspect CI logs for the new run.
5. Mark PR #4 ready for review if it is still draft.
6. Merge PR #4 into `main`.
7. Checkout local `main`.
8. Fast-forward pull from origin:

```bash
git checkout main
git pull --ff-only origin main
```

9. Update `ai/state.json` on `main` in the next orchestrator cycle to mark Task 0001 complete and select Task 0002.

# If FAIL
Do not merge.

Write the verifier report with `Result: FAIL`, then leave a PR comment or review with:

- The blocking issue(s)
- The exact failing command(s) or file(s)
- The minimal required fix

Recommended PR comment command:

```bash
gh pr comment 4 --repo sourceplane/orun-backend --body-file <prepared-comment.md>
```
