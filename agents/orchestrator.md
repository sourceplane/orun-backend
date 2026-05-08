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
1. Read `/ai/context/current.md`
2. Read `/ai/context/task-ledger.md`, `/ai/context/decisions.md`, and `/ai/context/open-risks.md`
3. Read `/ai/state.json`
4. Read the relevant active V2 specs under `/spec/v2/**` for the area being planned
5. Consult old `/spec/*.md` files only as V1 implementation reference, compatibility context, or migration evidence
6. Inspect current repo code (not docs only)
7. Inspect open PRs, merged PRs, failing tests, stale READMEs
8. Compare progress vs V2 goal and current migration phase
9. Identify production-grade gaps, integration risks, missing seams
10. Inspect any outstanding `/ai/proposals/**` spec-change proposals
11. Accept, revise, defer, or ask the user about proposals before baking them into new tasks
12. Select next highest-leverage bounded task
13. Generate detailed prompt file
14. Wait for worker result
15. Update state and the compact context files
16. Repeat
---
# Core Principle
**Trust code reality over stale documentation.**
Always evaluate:
- what is implemented
- what is placeholder
- what passes quality gates
- what contracts already exist
- what next dependency unlocks the roadmap

Active architecture source:

* `/spec/v2/**` is the authoritative spec set for all new Orun SaaS work.
* The old `/spec/*.md` files describe V1 behavior and are reference material
  only. Use them to understand current code, compatibility obligations, and
  migration details.
* If a worker finds that V2 and code reality conflict, prefer a bounded
  migration task or a V2 spec proposal. Do not silently fall back to V1 as the
  product direction.
* New task prompts must name the relevant V2 specs in `Read First`. Old specs
  may appear under `Reference Only` when needed.

Operational access assumptions:

* The Orchestrator, Implementer, and Verifier may assume full authenticated
  access to `gh` for GitHub PRs, Actions, checks, workflow logs, and repository
  inspection.
* They may assume full authenticated access to `wrangler` for Cloudflare
  deploys, resource inspection, bindings, Workers, Pages, Queues, R2, D1,
  Durable Objects, Hyperdrive, and secrets that are in task scope.
* They may assume local `supabase` CLI is installed and already logged in to
  the correct Supabase account for local workflows.
* GitHub Actions must provide `SUPABASE_API_KEY` as the canonical Supabase
  Management API secret for Terraform/Tactonic provisioning. Do not invent a
  second Supabase API secret name without updating
  `/spec/v2/07-provisioning-and-operations.md`.
* Supabase database provisioning must be planned as a Tactonic Terraform
  component task. If the exact Tactonic component naming or contract is unclear,
  ask the user before implementation.
* When credential scope, Supabase account/project, Cloudflare account,
  GitHub repository target, environment target, or Tactonic naming is unclear,
  ask the user instead of guessing.
---
# Context Budget Rules
Historical task prompts and implementer/verifier reports are preserved in:

`/ai/archive/tasks-reports-20260508.tar.gz`

Do not unpack or read that archive during routine planning. Use
`/ai/context/task-ledger.md` to identify the small number of historical tasks
that matter to current work. Only inspect full archived prompts/reports when
source code, specs, state, and compact context are insufficient.

New task prompts still go in `/ai/tasks/`. New implementer/verifier reports
still go in `/ai/reports/`. After a task is verified, update `/ai/context/*`
with the durable outcome and keep the report concise.

Preferred report budget:

* Summary: 3-5 bullets
* Files Changed: grouped by subsystem, not a full diff
* Checks Run: exact commands and result
* Assumptions: only durable assumptions
* Spec Proposals: links only, with one-line reason
* Remaining Gaps: actionable residual risk only
* PR Number: one line

Preferred task prompt budget:

* Include only the current objective, relevant context, required outcomes,
  constraints, acceptance criteria, and reporting expectations.
* Link to specs and compact context instead of pasting long prior task content.
* Avoid duplicating file inventories that can be discovered with `rg --files`.

---
# Spec Change Proposals
Specs guide implementation, but implementation and verification may reveal that a spec is stale, incomplete, internally inconsistent, or missing a necessary seam.

Workers are allowed to identify needed spec updates without being blocked by them.

When an Implementer, Verifier, or the Orchestrator itself finds a spec update is needed, create a proposal file instead of silently changing direction:

`/ai/proposals/task-0021-spec-update.md`

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
  "goal": "Supabase/Postgres-backed multi-organization Orun SaaS control plane",
  "current_task": 21,
  "completed": [1,2,3],
  "repo_health": "yellow",
  "next_focus": "v2-db-foundation",
  "last_verified": "2026-05-08"
}
```

⸻

Task Files

/ai/tasks/task-0021.md

/ai/proposals/task-0021-spec-update.md when spec changes need Orchestrator review

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

/ai/reports/task-0021-implementer.md

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

/ai/reports/task-0021-verifier.md

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

* trust code for current behavior, trust `/spec/v2/**` for product direction,
  require a proposal for meaningful V2 spec changes, and update docs/specs
  intentionally

If seams weak:

* strengthen seam before adding features

⸻

Example Prompt Output

# Task 21
Agent: Implementer
Current Repo Context:
V2 specs are now authoritative. Existing V1 Cloudflare/D1 backend remains live
and must keep compatibility behavior while V2 is introduced incrementally.
Objective:
Create `packages/db` with the first Supabase/Postgres migration harness and
core organization/user/project schema. Do not alter runtime API behavior yet.
Read First:
spec/v2/README.md
spec/v2/00-architecture.md
spec/v2/01-data-model.md
spec/v2/07-provisioning-and-operations.md
spec/v2/06-migration-from-v1.md
Reference Only:
spec/07-storage.md
migrations/**
Constraints:
No V1 endpoint behavior changes.
No D1 authoritative tenant additions.
No secrets in migrations or fixtures.
Acceptance:
Postgres migrations checked in.
Supabase provisioning assumptions use `SUPABASE_API_KEY` and the Tactonic
Terraform component contract.
DB package typechecks.
Core schema test or migration smoke exists.
PR opened.

⸻

Final Principle

The Orchestrator thinks like a staff engineer:

* evaluate reality
* choose leverage
* keep quality high
* ship incrementally
* never plan from assumptions
