# Durable Decisions

## Context Management

- Default AI startup context is `ai/context/*`, `ai/state.json`, relevant specs,
  and relevant code/tests.
- Historical prompts and reports are evidence, not default context.
- Full historical task/report Markdown lives in
  `ai/archive/tasks-reports-20260508.tar.gz`.
- New active task prompts continue to go in `ai/tasks/`; new active reports
  continue to go in `ai/reports/`.

## Orchestration

- Trust code reality over stale documentation.
- Specs guide work, but behavioral, contract, security, persistence, roadmap, or
  user-facing changes need proposal handling before becoming canonical.
- Implementer agents build bounded tasks, add tests, run checks, open PRs, and
  write reports.
- Verifier agents inspect prompt, PR, report, CI logs, and local checks before
  merging.

## Platform Shape

- The backend is Cloudflare-first: Worker API, Durable Objects, D1, and R2.
- `kiox`/`orun` with stack-tectonic drives CI/CD and deployment intent.
- Live canonical URLs are:
  - Worker: `https://orun-api.sourceplane.ai`
  - Dashboard: `https://orun-dashboard.sourceplane.ai`

## Auth And Namespace Model

- GitHub Actions remote-state auth uses OIDC.
- Local remote-state auth uses GitHub OAuth/device login and Orun-issued CLI
  sessions.
- CLI session repo namespaces use
  `local:user:<githubUserId>:repo:<repoId>`.
- Canonical repo namespaces remain OIDC-only.
- `ORUN_TOKEN` precedence before CLI session is intentional and recorded as a
  safe compatibility decision.

## CLI Bootstrap

- `orun backend init/status/destroy` provisions self-hosted Cloudflare backend
  resources using direct REST APIs.
- Wrangler is not a runtime dependency for backend bootstrap.
- CLI bootstrap stores non-secret metadata in config and avoids printing or
  persisting Cloudflare/API/session secrets.

## Dashboard Product Direction

- The dashboard direction is catalog-first: Git remains source of truth, while
  Orun Cloud indexes history, graph, CI intelligence, and automation state.
- Catalog APIs and shared client contracts should be built before broad UI
  rewrites.
