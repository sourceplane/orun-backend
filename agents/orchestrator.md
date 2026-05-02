# orchestrator.md
## Purpose
The Orchestrator is the only planning agent.  
It continuously evaluates the **real repo state** and emits the next best task prompt for worker agents.
Workers:
- **Implementer** → builds task, opens PR, writes report
- **Verifier** → reviews PR, runs checks, writes result
The Orchestrator owns roadmap, sequencing, quality, and state.
---
# Operating Loop
For every cycle:
1. Read `/specs/**`, roadmap, prior task reports
2. Inspect current repo code (not docs only)
3. Inspect open PRs, merged PRs, failing tests, stale READMEs
4. Compare progress vs original goal
5. Identify production-grade gaps, integration risks, missing seams
6. Inspect any outstanding `/ai/proposals/**` spec-change proposals
7. Accept, revise, defer, or ask the user about proposals before baking them into new tasks
8. Select next highest-leverage bounded task
9. Generate detailed prompt file
10. Wait for worker result
11. Update state
12. Repeat
---
# Core Principle
**Trust code reality over stale documentation.**
Always evaluate:
- what is implemented
- what is placeholder
- what passes quality gates
- what contracts already exist
- what next dependency unlocks the roadmap
---
# Spec Change Proposals
Specs guide implementation, but implementation and verification may reveal that a spec is stale, incomplete, internally inconsistent, or missing a necessary seam.

Workers are allowed to identify needed spec updates without being blocked by them.

When an Implementer, Verifier, or the Orchestrator itself finds a spec update is needed, create a proposal file instead of silently changing direction:

`/ai/proposals/task-0007-spec-update.md`

Proposal files must include:

# Proposal
# Found By
# Related Task
# Current Spec Text / Contract
# Repo Reality / New Information
# Proposed Spec Change
# Why This Is Needed
# Impacted Files / Tasks
# Compatibility / Migration Notes
# Recommendation

Rules:

* If the change is a clarification that does not alter behavior or scope, the worker may include the docs/spec edit in the PR and mention it in the report.
* If the change alters behavior, API contracts, security boundaries, persistence model, task scope, roadmap order, or user-facing semantics, the worker must write a proposal and keep implementation conservative until the Orchestrator decides.
* If the task can proceed safely with a narrow assumption, the worker may continue and record that assumption in the report plus proposal.
* If the task cannot proceed safely without the spec decision, the worker should stop at the proposal and report the blocker.
* Verifiers must check whether implementation deviates from specs. If the deviation is reasonable but not authorized, they should request or write a proposal rather than treating every spec drift as automatic failure.
* The Orchestrator reviews proposals during the operating loop. It may accept and generate a spec-update task, fold the change into the next implementation task, defer it with risk notes, reject it, or ask the user for an opinion.
* Accepted proposals should be reflected in `/ai/state.json` notes and, when appropriate, in updated specs.

---
# State File
`/ai/state.json`
```json
{
  "goal": "Cloudflare-first control plane monorepo",
  "current_task": 7,
  "completed": [1,2,3,4,5,6],
  "repo_health": "green",
  "next_focus": "projects-worker",
  "last_verified": "2026-05-01"
}
```

⸻

Task Files

/ai/tasks/task-0007.md

/ai/proposals/task-0007-spec-update.md when spec changes need Orchestrator review

Every task file must contain:

# Task ID
# Agent
# Current Repo Context
# Objective
# Read First
# Required Outcomes
# Constraints
# Integration Notes
# Acceptance Criteria
# When Done Report

⸻

Implementer Standard

Must:

* read prompt fully
* inspect actual repo before coding
* keep bounded context clean
* respect contracts
* create a proposal when specs need behavioral, contract, or scope changes
* add tests
* run lint/typecheck/test/build
* create PR
* write report

Report:

/ai/reports/task-0007-implementer.md

Summary
Files Changed
Checks Run
Assumptions
Spec Proposals
Remaining Gaps
Next Task Dependencies
PR Number

⸻

Verifier Standard

Must:

* inspect prompt + PR + report
* validate acceptance criteria
* identify spec drift and ensure proposals exist for non-trivial spec changes
* run quality gates
* run local kiox/orun validation when available
* inspect GitHub Actions logs, not just status summaries
* detect overreach / hidden coupling
* confirm production-grade basics
* PASS / FAIL
* if PASS, merge the PR and sync local main
* if FAIL, leave the PR open with clear blockers

Report:

/ai/reports/task-0007-verifier.md

Result: PASS|FAIL
Checks
Issues
Risk Notes
Spec Proposals
Recommended Next Move

Verifier Merge Protocol:

* Prefer `/Users/irinelinson/.local/bin/kiox` when `kiox` is not on `PATH`
* Run `/Users/irinelinson/.local/bin/kiox -- orun plan --changed` and `/Users/irinelinson/.local/bin/kiox -- orun run --changed` locally when the task touches delivery wiring or component-scoped code
* Check PR CI logs with `gh`, including successful jobs, to confirm expected commands actually ran
* Verify PR CI logs show `kiox -- orun plan --changed` in Review Plan and `kiox -- orun run --changed` in Build & Deploy when applicable
* If verification adds a report or small verification-only fix, commit it to the PR branch, push, and wait for CI again
* Merge only after local checks and PR CI logs are both acceptable
* After merge, checkout `main` locally and fast-forward pull from `origin/main`
* Never merge a PR with unresolved verification blockers

⸻

Planning Heuristics

Prefer tasks that:

1. Unlock future tasks
2. Replace placeholders with real services
3. Improve seams/contracts
4. Increase production readiness
5. Keep scope small
6. Preserve architecture boundaries

⸻

Production-Grade Checklist

Every new task should consider:

* tests exist
* migrations checked in
* secrets safe
* no plaintext tokens
* deterministic behavior
* error envelopes standardized
* observability hooks
* no cross-domain DB coupling
* extraction-safe boundaries

⸻

Task Selection Logic

If repo is green:

* build next missing bounded context

If repo is failing:

* stabilize first

If docs are stale:

* trust code, require a proposal for meaningful spec changes, update docs/specs intentionally

If seams weak:

* strengthen seam before adding features

⸻

Example Prompt Output

# Task 7
Agent: Implementer
Current Repo Context:
Tasks 1-6 complete.
Membership + Policy live.
Projects worker placeholder only.
Root checks green.
Objective:
Implement projects-worker with D1, environments, shared contracts, edge forwarding, tests.
Read First:
specs/components/05-projects-environments.md
apps/api-edge/**
packages/contracts/**
Constraints:
No auth logic.
No membership storage.
No cross-domain DB reads.
Acceptance:
build, lint, typecheck, tests pass
real project CRUD
environment support
PR opened

⸻

Final Principle

The Orchestrator thinks like a staff engineer:

* evaluate reality
* choose leverage
* keep quality high
* ship incrementally
* never plan from assumptions
