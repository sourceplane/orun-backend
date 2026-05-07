## Product direction

Build **Orun Dashboard** as a **Git-native software catalog + CI intelligence layer**.

The key difference from Backstage should be this:

> Backstage asks teams to maintain catalog metadata and then connect plugins.
> Orun can **derive the catalog from the same plan engine that already understands components, environments, dependencies, jobs, PR changes, and execution history**.

Backstage’s catalog is centered around ownership and metadata for software assets, usually harvested from YAML files stored with code. That is a strong model to learn from. But Orun’s advantage is that its catalog can be **execution-aware by default**: every component is not only “registered,” but connected to plans, runs, environments, dependencies, logs, PRs, and policies. ([Backstage][1])

Your current Orun/Gluon model already has the right foundation: `plan` compiles intent, component discovery, and compositions into an immutable DAG; it supports changed-component planning; and the generated plan carries jobs, dependencies, labels, steps, runtime metadata, and checksums. 

---

# 1. Core product model

Think of the dashboard as four layers:

```text
Source of Truth     Git repos, component.json, intent.yaml, stack.yaml
Compile Layer       orun plan / validate / component / changed detection
Cloud Index         normalized catalog, runs, PR history, scorecards, relations
Product UI          catalog, component pages, dependency graph, actions, insights
```

The dashboard should not become the source of truth too early. The repo should remain the canonical source. The cloud should be the **index, history, graph, and automation layer**.

---

# 2. Main dashboard views

## A. Global Catalog

This is the homepage.

It should support:

| View                   | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| **All Components**     | Everything across all linked repos                             |
| **By Repository**      | Components grouped by repo                                     |
| **By System / Domain** | Product/system-level ownership                                 |
| **By Environment**     | dev, staging, production visibility                            |
| **By Type**            | service, worker, helm chart, terraform, database, package, job |
| **By Tags**            | `cloudflare`, `aws`, `frontend`, `critical`, `customer-facing` |
| **By Status**          | healthy, failing, stale, recently changed, missing owner       |

Each row/card should show:

```text
component name
type
repo
owner/team
system/domain
environments
latest plan status
latest pipeline status
last changed PR
risk/score
tags
```

The catalog should have both **table mode** and **card mode**. Table mode is better for platform/SRE users. Card mode is better for developers and product teams.

---

## B. Component Page

Each component gets a rich page.

Suggested tabs:

```text
Overview
Runs
PR History
Dependencies
Environments
Config
Logs
Docs
Scorecard
Actions
```

### Overview

Show the component identity:

```text
Name: api-edge-worker
Type: cloudflare-worker
Repo: sourceplane/example-platform-repo
Owner: platform
System: saas-platform
Tags: cloudflare, edge, api
Environments: dev, staging, production
```

Then show status cards:

```text
Latest plan        success
Latest deploy      success
Last PR            #184
Production drift   none
Score              92 / 100
```

### Runs

Show latest Orun plans and pipelines that touched this component.

```text
Plan ID
Commit
Branch
PR
Environment
Jobs
Status
Duration
Triggered by
```

### PR History

This should be one of Orun’s best features.

For each component:

```text
PR #184 changed api-edge-worker
- files changed
- component fields changed
- jobs affected
- environments affected
- plan diff
- risk score
```

This makes Orun more useful than a generic catalog because it can answer:

> “Who changed this component?”
> “What pipeline ran after it changed?”
> “Which environment was affected?”
> “What dependency chain was impacted?”

### Dependencies

Render the dependency graph:

```text
api-edge-worker
 ├─ depends on auth-worker
 ├─ consumes user-api
 ├─ deploys with cloudflare-worker composition
 └─ shares terraform resource cloudflare-zone
```

Backstage models Components, APIs, and Resources as core catalog entities, which is useful, but Orun should add **job-level and environment-level dependency visibility**. ([Backstage][2])

### Actions

This is where Orun can later compete with Backstage templates and scaffolder actions.

Examples:

```text
Run plan
Deploy staging
Promote to production
Open logs
Create rollback PR
Generate component README
Request ownership update
Run policy check
Trigger approved ad-hoc job
```

Backstage Software Templates provide a scaffolding system for creating software from YAML-defined templates and actions; Orun can evolve a similar concept, but make it plan/composition-native instead of portal-plugin-native. ([Backstage][3])

---

# 3. Data contracts

Use three different JSON concepts. Do not overload `component.json`.

## 1. `component.json`

This is the source-owned descriptor. It lives in the repo.

```json
{
  "apiVersion": "orun.io/v1",
  "kind": "Component",
  "metadata": {
    "name": "api-edge-worker",
    "title": "API Edge Worker",
    "description": "Cloudflare Worker that serves the public API edge.",
    "tags": ["cloudflare", "edge", "api"],
    "owner": "team-platform",
    "system": "saas-platform"
  },
  "spec": {
    "type": "cloudflare-worker",
    "lifecycle": "production",
    "repoPath": "apps/api-edge-worker",
    "environments": ["dev", "staging", "production"],
    "dependsOn": [
      "component:auth-worker"
    ],
    "providesApis": [
      "api:public-edge-api"
    ],
    "resources": [
      "resource:cloudflare-zone",
      "resource:kv-session-store"
    ]
  }
}
```

This should be human-friendly and Git-reviewable.

## 2. `component-state.json`

This is generated by `orun plan` and uploaded to the cloud.

```json
{
  "apiVersion": "orun.io/v1",
  "kind": "ComponentState",
  "tenant": {
    "orgId": "org_123"
  },
  "source": {
    "provider": "github",
    "repository": "sourceplane/example-platform-repo",
    "repoId": "123456",
    "branch": "main",
    "commit": "abc123",
    "workflowRunId": "987654"
  },
  "component": {
    "id": "github:123456:api-edge-worker",
    "name": "api-edge-worker",
    "type": "cloudflare-worker",
    "owner": "team-platform",
    "system": "saas-platform",
    "tags": ["cloudflare", "edge", "api"],
    "path": "apps/api-edge-worker/component.json"
  },
  "environments": [
    {
      "name": "production",
      "status": "healthy",
      "latestJobId": "api-edge-worker@production.deploy"
    }
  ],
  "plan": {
    "planId": "plan_abc",
    "checksum": "sha256:...",
    "changed": true,
    "affectedJobs": [
      "api-edge-worker@production.deploy"
    ]
  },
  "pr": {
    "number": 184,
    "title": "Update API worker routing",
    "changedFiles": [
      "apps/api-edge-worker/component.json",
      "apps/api-edge-worker/src/router.ts"
    ]
  },
  "generatedAt": "2026-05-07T10:00:00Z"
}
```

## 3. `catalog-sync-envelope.json`

This wraps all uploaded data.

```json
{
  "apiVersion": "orun.io/v1",
  "kind": "CatalogSyncEnvelope",
  "uploadId": "upl_01hx...",
  "schemaVersion": "2026-05-01",
  "source": {
    "provider": "github",
    "repo": "sourceplane/example-platform-repo",
    "repoId": "123456",
    "commit": "abc123",
    "workflowRunId": "987654",
    "workflowRef": "sourceplane/example-platform-repo/.github/workflows/orun-plan.yaml@refs/heads/main"
  },
  "plan": {
    "id": "plan_abc",
    "checksum": "sha256:...",
    "objectRef": "r2://plans/org/repo/commit/plan.json"
  },
  "components": [
    {
      "name": "api-edge-worker",
      "stateRef": "r2://components/org/repo/commit/api-edge-worker.json"
    }
  ],
  "signature": {
    "type": "github-oidc",
    "jwtAudience": "orun-cloud",
    "verified": true
  }
}
```

This envelope gives you replay protection, schema versioning, auditability, and clean evolution.

---

# 4. Upload flow from GitHub Actions to Orun Cloud

Recommended flow:

```text
git push / PR
   ↓
GitHub Actions starts
   ↓
orun validate
   ↓
orun plan --changed --output plan.json
   ↓
orun catalog export --plan plan.json --output catalog-sync.json
   ↓
GitHub OIDC token requested
   ↓
POST /v1/catalog/sync
   ↓
Cloudflare Worker verifies identity
   ↓
Raw payload stored in R2
   ↓
Queue event emitted
   ↓
Normalizer writes queryable data to D1
   ↓
Dashboard updates catalog, PR history, runs, graph
```

GitHub Actions OIDC is the right production identity mechanism because each job can obtain a signed token with claims that identify the workflow, repo, branch/ref, and run context; the cloud side can verify those claims instead of storing long-lived secrets. ([GitHub Docs][4])

The CI UX should be simple:

```yaml
name: orun-catalog-sync

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read
  id-token: write

jobs:
  catalog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Orun
        uses: sourceplane/setup-orun@v1

      - name: Validate
        run: orun validate --intent intent.yaml

      - name: Plan
        run: |
          orun plan \
            --intent intent.yaml \
            --changed \
            --base "${{ github.event.pull_request.base.ref || 'main' }}" \
            --output plan.json

      - name: Export catalog state
        run: |
          orun catalog export \
            --plan plan.json \
            --output catalog-sync.json

      - name: Upload to Orun Cloud
        run: |
          orun cloud sync \
            --endpoint https://api.orun.dev \
            --file catalog-sync.json \
            --oidc-audience orun-cloud
```

---

# 5. Cloudflare backend design

Use Cloudflare as the control plane.

## Recommended services

| Need                                    | Cloudflare service |
| --------------------------------------- | ------------------ |
| API layer                               | Workers            |
| UI hosting                              | Pages              |
| relational query index                  | D1                 |
| immutable raw payloads, plans, logs     | R2                 |
| async ingestion pipeline                | Queues             |
| per-execution coordination / live state | Durable Objects    |
| semantic search later                   | Vectorize          |

Cloudflare Workers are a serverless platform for building and scaling apps on Cloudflare’s global network. D1 is Cloudflare’s managed serverless SQL database with SQLite semantics. R2 is S3-compatible object storage with zero egress fees, which makes it a good place for plans, raw component snapshots, logs, and historical artifacts. Queues let Workers offload asynchronous processing and buffer/batch work. ([Cloudflare Docs][5])

Durable Objects should be used later for live execution state, locks, WebSockets, and matrix-job coordination, because they provide globally unique stateful objects with strongly consistent storage and are suited for coordination-heavy distributed systems. ([Cloudflare Docs][6])

---

# 6. Storage model

Use a dual-storage model:

```text
D1 = query/index/current state
R2 = raw immutable artifacts/history
```

Do not store huge JSON blobs only in D1. D1 should answer dashboard queries quickly. R2 should preserve the original truth.

## D1 tables

Minimal schema:

```sql
tenants
  id
  name
  created_at

repositories
  id
  tenant_id
  provider
  provider_repo_id
  full_name
  default_branch
  last_synced_at

components
  id
  tenant_id
  repository_id
  name
  type
  owner
  system
  lifecycle
  path
  description
  current_state_ref
  updated_at

component_tags
  component_id
  tag

component_environments
  component_id
  environment
  status
  latest_run_id
  latest_job_id
  updated_at

component_relations
  source_component_id
  relation_type
  target_kind
  target_ref

plans
  id
  tenant_id
  repository_id
  commit_sha
  branch
  checksum
  status
  plan_ref
  generated_at

pipeline_runs
  id
  tenant_id
  repository_id
  plan_id
  provider
  workflow_run_id
  status
  started_at
  completed_at

jobs
  id
  run_id
  component_id
  environment
  job_name
  status
  duration_ms
  log_ref

pull_requests
  id
  tenant_id
  repository_id
  number
  title
  author
  state
  merged_at
  updated_at

component_pr_changes
  component_id
  pull_request_id
  commit_sha
  change_type
  changed_files_json
  plan_id
  created_at
```

## R2 object layout

```text
r2://orun-artifacts/
  tenants/{tenantId}/
    repos/{repoId}/
      commits/{sha}/
        plan.json
        catalog-sync-envelope.json
        components/{componentName}.json
      runs/{runId}/
        jobs/{jobId}/logs.txt
        jobs/{jobId}/state.json
      prs/{number}/
        component-diff.json
```

This lets you keep D1 small and fast while R2 stores full historical artifacts cheaply and durably.

---

# 7. Ingestion API

Start with these endpoints:

```text
POST /v1/catalog/sync
GET  /v1/catalog/components
GET  /v1/catalog/components/:id
GET  /v1/catalog/components/:id/history
GET  /v1/catalog/components/:id/runs
GET  /v1/catalog/components/:id/dependencies
GET  /v1/repos/:repoId/components
GET  /v1/runs/:runId
GET  /v1/plans/:planId
```

Ingestion should be append-first:

```text
1. verify auth
2. validate schema
3. write raw envelope to R2
4. enqueue normalization job
5. return upload accepted
6. async worker updates D1 indexes
```

This avoids making GitHub Actions wait for all catalog processing.

---

# 8. Security model

For production, prefer:

```text
GitHub App installation + OIDC verification + repo allowlist + schema validation
```

Use OIDC to prove the upload came from a real GitHub Actions workflow in an allowed repo. Use GitHub App installation to manage org/repo access, permissions, and UI linking.

Validation checks:

```text
repo_id matches linked repo
workflow_ref is allowed
branch/ref is allowed
commit sha matches payload
plan checksum matches uploaded plan
component paths are inside repo
schema version is supported
payload size is within limit
upload id is not replayed
```

For open-source/free mode, you can still support capability-token uploads, but treat that as a convenience path. A capability token can identify “someone with this URL/token can upload,” but it cannot strongly prove the workload identity the same way OIDC can.

---

# 9. Product features that make Orun stronger than Backstage

## Phase 1: Catalog MVP

Build:

```text
global component catalog
repo catalog
component detail page
tags and filters
latest plan/run status
PR history per component
R2 raw artifact viewer
GitHub OIDC sync
```

This is enough to be useful.

## Phase 2: CI intelligence

Add:

```text
plan diff viewer
affected components per PR
dependency impact graph
job-level history
environment promotion timeline
component failure trends
slowest jobs
flaky jobs
```

This is where Orun becomes more than a catalog.

## Phase 3: Scorecards and policy

Add:

```text
ownership score
production-readiness score
observability score
security score
deployment safety score
documentation score
```

Example component score:

```text
Owner exists                  ✅
Production env declared       ✅
Rollback job available        ✅
SLO linked                    ⚠️
Runbook linked                ❌
Last successful deploy < 7d   ✅
```

## Phase 4: Actions and self-service

Add approved actions:

```text
run plan
deploy staging
promote production
rollback
rotate secret workflow
create environment
generate component
create repo from stack
```

The important rule:

> The UI should dispatch **approved Orun capabilities**, not arbitrary shell commands.

That keeps the SaaS trusted.

## Phase 5: AI-native platform

Add:

```text
Ask: “What changed in checkout last week?”
Ask: “Which components depend on auth-worker?”
Ask: “Why did production deploy fail?”
Ask: “Generate a migration PR for this component.”
Ask: “Create a new Cloudflare Worker from the approved stack.”
```

Cloudflare Vectorize can later support semantic search across component metadata, docs, PR summaries, logs, and runbooks; Vectorize is Cloudflare’s vector database for Workers-based AI applications. ([Cloudflare Docs][7])

---

# 10. Recommended UX shape

## Catalog table

```text
Component              Type                Repo             Owner       Env        Status
api-edge-worker        cloudflare-worker   platform-repo    platform    prod       healthy
web-console            cloudflare-pages    platform-repo    frontend    staging    failing
billing-worker         worker              billing-repo      billing     prod       stale
checkout-chart         helm-chart          commerce-repo     commerce    prod       healthy
```

## Component page header

```text
api-edge-worker
Cloudflare Worker · sourceplane/example-platform-repo · team-platform

Status: healthy
Latest plan: success
Latest deploy: production · 12m ago
Last changed by: PR #184
Score: 92
```

## Component timeline

```text
Today
  ✅ production deploy succeeded
  ✅ plan generated for commit abc123

Yesterday
  🔀 PR #184 modified router.ts and component.json
  ⚠️ staging deploy failed once, retry succeeded

Last week
  📝 owner changed from edge-team to platform-team
```

## Dependency graph

```text
public-edge-api
      ↑
api-edge-worker
      ↓
auth-worker
      ↓
identity-store
```

---

# 11. Best architectural principle

The strongest design is:

> **Every Git commit produces a catalog event. Every plan produces a graph event. Every run produces an execution event. The dashboard materializes these events into a searchable software catalog.**

That gives you a scalable event-sourced model without making the UI depend on live Git scans.

---

# 12. What Orun should build into the CLI

Add these commands:

```bash
orun catalog export
orun cloud sync
orun cloud login
orun cloud link-repo
orun cloud verify
orun component diff
orun plan diff
orun scorecard
```

Suggested behavior:

```bash
orun plan --changed --output plan.json

orun catalog export \
  --plan plan.json \
  --output catalog-sync.json

orun cloud sync \
  --file catalog-sync.json \
  --oidc
```

Later:

```bash
orun cloud sync --auto
```

This would run plan, export, sign, and upload in one command.

---

# 13. Final recommendation

Build the MVP around this contract:

```text
Repo-owned component.json
        ↓
orun plan creates deterministic plan.json
        ↓
orun catalog export creates component-state snapshots
        ↓
GitHub Actions uploads signed sync envelope
        ↓
Cloudflare Worker verifies identity
        ↓
R2 stores raw artifacts
        ↓
Queue normalizes into D1
        ↓
Dashboard renders catalog, component pages, PR history, runs, graph
```

This is scalable, cheap, Git-native, and product-friendly.

The long-term wedge against Backstage is not “another catalog.” It is:

> **A catalog that understands how your platform is planned, changed, deployed, and debugged.**

[1]: https://backstage.io/docs/features/software-catalog/?utm_source=chatgpt.com "Backstage Software Catalog and Developer Platform"
[2]: https://backstage.io/docs/features/software-catalog/system-model/?utm_source=chatgpt.com "System Model | Backstage Software Catalog and Developer ..."
[3]: https://backstage.io/docs/features/software-templates/?utm_source=chatgpt.com "Backstage Software Templates"
[4]: https://docs.github.com/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect?utm_source=chatgpt.com "OpenID Connect"
[5]: https://developers.cloudflare.com/workers/?utm_source=chatgpt.com "Overview · Cloudflare Workers docs"
[6]: https://developers.cloudflare.com/durable-objects/?utm_source=chatgpt.com "Overview · Cloudflare Durable Objects docs"
[7]: https://developers.cloudflare.com/vectorize/?utm_source=chatgpt.com "Overview · Cloudflare Vectorize docs"
