# Current AI Context

This is the default starting context for planning agents. Read this file, then
`task-ledger.md`, `decisions.md`, and `open-risks.md` before opening historical
task prompts or implementation reports.

## Repo Goal

Build a Cloudflare-first Orun control plane monorepo:

- Worker API on Cloudflare Workers
- Durable Object run coordinator
- D1/R2 persistence
- GitHub OIDC plus local CLI auth
- dashboard catalog and CI intelligence surface
- CLI integration for remote state and self-hosted backend bootstrap

## Current State

- Current task pointer: task 0016
- Last verified: 2026-05-08
- Repo health: yellow
- Live Worker: `https://orun-api.sourceplane.ai`
- Live Dashboard: `https://orun-dashboard.sourceplane.ai`
- Stack version: `oci://ghcr.io/sourceplane/stack-tectonic:0.12.0`

Repo health is yellow because the original Task 0012 local conformance verifier
report is still recorded as FAIL and no Task 0012.1 verifier report exists,
although later remediation tasks passed. Treat this as a bookkeeping and
re-verification risk, not as evidence that the current main branch is broken.

## Default Read Order

1. `ai/context/current.md`
2. `ai/context/task-ledger.md`
3. `ai/context/decisions.md`
4. `ai/context/open-risks.md`
5. `ai/state.json`
6. Relevant `spec/*.md`
7. Actual source and tests for the area being changed

Do not read the archived historical task/report bundle by default. Open it only
when the compact ledger points at a task that is directly relevant to current
work and the source/specs are insufficient.

## Historical Archive

Verbose historical task prompts and implementer/verifier reports were compressed
on 2026-05-08 to reduce default AI context usage:

```bash
ai/archive/tasks-reports-20260508.tar.gz
```

To inspect the full history without restoring it into the repo surface:

```bash
mkdir -p /tmp/orun-backend-ai-history
tar -xzf ai/archive/tasks-reports-20260508.tar.gz -C /tmp/orun-backend-ai-history
```

New active task prompts should still be written under `ai/tasks/`, and new active
reports should still be written under `ai/reports/`.
