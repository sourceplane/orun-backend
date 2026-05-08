# Spec V2-07 - Provisioning And Operations

## Scope

This spec defines how V2 infrastructure is provisioned and operated for
Supabase/Postgres, Cloudflare, GitHub, and local development.

It is authoritative for:

- Supabase project and database provisioning
- Terraform/Tactonic component boundaries
- GitHub Actions secrets and operational credentials
- `gh`, `wrangler`, and `supabase` CLI expectations
- migration and deployment workflows

It does not define application data tables. See `spec/v2/01-data-model.md` for
schema contracts and `spec/v2/04-storage-and-ingestion.md` for runtime data
movement.

## Operating Assumptions

The V2 delivery environment has full operational access to the normal project
toolchain:

- `gh` is available and authenticated for repository, pull request, checks,
  workflow logs, and Actions inspection.
- `wrangler` is available and authenticated for Cloudflare Worker, Pages,
  Hyperdrive, Queue, R2, D1, and secret operations that are in task scope.
- `supabase` CLI is available locally and already logged in to Supabase.
- GitHub Actions has access to repository/environment secrets required by CI,
  provisioning, and deploy workflows.

Agents should use these tools directly when a task needs them. If a command
fails because credentials are missing, expired, scoped incorrectly, or pointed
at the wrong account, the agent must ask for clarification or report the
blocker. Do not create alternate credentials, paste secrets into files, or
switch providers silently.

When the Supabase account/project, Cloudflare account, GitHub repository,
environment target, or Tactonic component naming is unclear, ask the user before
planning an irreversible provisioning action.

## Required Secrets

GitHub Actions must define:

| Secret | Purpose |
| --- | --- |
| `SUPABASE_API_KEY` | Supabase Management API token used by Terraform/Tactonic and CI provisioning |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account target for Worker, Pages, Queues, R2, D1, and Hyperdrive |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token used by `wrangler` and Cloudflare REST provisioning |

Additional environment-specific secrets may exist for GitHub App credentials,
Stripe, or deploy-specific resources, but `SUPABASE_API_KEY` is the canonical
secret name for Supabase provisioning. Do not introduce a second secret name
such as `SUPABASE_ACCESS_TOKEN` unless a migration task explicitly aliases it
and updates this spec.

Runtime Worker secrets are separate from provisioning secrets. The Worker
should receive only the minimum runtime bindings and secrets it needs.

## Local Supabase Assumption

Local development assumes:

- Supabase CLI is installed.
- `supabase login` has already completed for the correct Supabase account.
- The local project can be linked with `supabase link` when a live project is
  required.
- Unit tests do not require a live Supabase project.

Local workflows may use:

```bash
supabase projects list
supabase link --project-ref <project-ref>
supabase db push
supabase db reset
supabase migration new <name>
```

The exact commands should be wrapped by package scripts once `packages/db`
exists. Direct CLI usage is acceptable while the migration harness is being
created.

## Provisioning Model

V2 provisioning is split into two layers:

1. Platform resources are provisioned through Terraform/Tactonic and Cloudflare
   tooling.
2. Application schema changes are delivered through versioned database
   migrations owned by `packages/db`.

Terraform must create and configure the Supabase project/database and expose
connection outputs. Terraform must not become the owner of application DDL such
as `organizations`, `projects`, `runs`, or catalog tables. Those tables belong
to the migration harness in `packages/db`.

## Tactonic Terraform Component

The Tactonic stack must include a Terraform component type for Supabase
database provisioning. Until a repo-local Tactonic schema exists, use this
contract as the target component shape.

Component type:

```hcl
component "orun_supabase_database" {
  type = "supabase-postgres"
}
```

Required inputs:

| Input | Description |
| --- | --- |
| `environment` | Environment name such as `dev`, `preview`, `staging`, or `prod` |
| `organization_slug` | Owning product or company slug for naming and tags |
| `project_name` | Supabase project display name |
| `region` | Supabase region chosen for the environment |
| `database_password_secret_ref` | Reference to the database password secret, not the password value |
| `supabase_api_key_secret_ref` | Must resolve to GitHub Actions secret `SUPABASE_API_KEY` in CI |
| `enable_branching` | Whether preview/branch databases are allowed for this environment |
| `allowed_cidr_blocks` | Optional network allow list when supported by plan/account |
| `tags` | Standard ownership, cost, and environment tags |

Required outputs:

| Output | Description |
| --- | --- |
| `supabase_project_ref` | Supabase project reference |
| `supabase_project_url` | Supabase API URL used by dashboard auth and service discovery |
| `supabase_jwks_url` | JWKS URL used by the Worker to verify Supabase Auth JWTs |
| `postgres_host` | Database host for Hyperdrive/database connection configuration |
| `postgres_port` | Database port |
| `postgres_database` | Database name |
| `postgres_user_secret_ref` | Reference to database username secret |
| `postgres_password_secret_ref` | Reference to database password secret |
| `database_url_secret_ref` | Reference to direct database URL for migration jobs only |
| `hyperdrive_database_url_secret_ref` | Reference used to create/update Cloudflare Hyperdrive |

The component must support idempotent plan/apply and must be safe to run from
GitHub Actions.

## Terraform Provider Boundary

Terraform should use the official Supabase provider or an approved internal
wrapper exposed through Tactonic. The provider token is sourced from:

```bash
SUPABASE_API_KEY
```

CI must pass this value as an environment variable or provider input without
printing it. Terraform plans must redact sensitive outputs. State must be
remote and encrypted through the approved Tactonic backend; local state is not
acceptable for shared environments.

Terraform may manage:

- Supabase project creation
- project region and organization placement
- database password/bootstrap secret references
- auth provider configuration when supported and reviewed
- preview/branch database settings when supported and reviewed
- Cloudflare Hyperdrive connection creation or input generation

Terraform must not manage:

- application tables, indexes, policies, or seed data
- long-lived GitHub personal access tokens
- checked-in database URLs
- runtime secrets in plaintext files

## Supabase Database Provision Flow

For a shared environment:

1. GitHub Actions starts a provisioning workflow.
2. Workflow checks out the repo and installs Terraform/Tactonic tooling.
3. Workflow exposes `SUPABASE_API_KEY` from Actions secrets.
4. Tactonic resolves the `orun_supabase_database` component.
5. Terraform plans the Supabase project/database changes.
6. On approved environments, Terraform applies the changes.
7. Outputs are written to the approved secret manager or GitHub environment
   secrets as references, not printed in logs.
8. Cloudflare Hyperdrive is created or updated from the database connection
   reference.
9. Worker environment variables are updated:
   - `SUPABASE_URL`
   - `SUPABASE_JWKS_URL`
   - `SUPABASE_JWT_AUDIENCE` when needed
10. Database migrations from `packages/db` run against the provisioned
    database.
11. `wrangler deploy` publishes the Worker with the correct bindings.
12. Smoke checks verify `/health`, `/v2/me`, database connectivity, and a
    minimal organization/project operation where safe.

For local development:

1. Developer confirms `supabase` CLI is logged in.
2. Developer links a project when live Supabase is needed.
3. Local `.dev.vars` or equivalent points to local/dev-only connection values.
4. `packages/db` migration scripts run locally.
5. Unit tests can run without a live project.

## GitHub Actions Workflow Requirements

Provisioning workflows must:

- use `SUPABASE_API_KEY` for Supabase Management API access
- use `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` for Cloudflare access
- use `gh` when PR, run, or check metadata is needed
- use `wrangler` for Worker deploy and Cloudflare resource inspection
- run Terraform plan before apply
- avoid printing secrets, connection strings, JWTs, or provider tokens
- upload sanitized plan summaries or artifacts only
- fail closed when required secrets are absent

Production applies should require the repository's normal environment
protection or manual approval. Preview/dev applies may be automated if the
workflow is idempotent and cost-controlled.

## Wrangler And Cloudflare Operations

`wrangler` is the canonical CLI for Cloudflare operations in implementation and
verification tasks.

Use `wrangler` for:

- Worker deploy
- Pages deploy when applicable
- Worker secret updates
- Hyperdrive inspection and creation when supported by the installed version
- Queue, D1, R2, and Durable Object binding verification
- tailing logs during smoke tests when needed

Use Cloudflare REST APIs only when `wrangler` does not expose the required
operation or the existing repo workflow already uses REST for that resource.

## GitHub CLI Operations

`gh` is the canonical CLI for GitHub operations in implementation and
verification tasks.

Use `gh` for:

- pull request creation and inspection
- workflow run status and logs
- Actions secret presence checks where permissions allow
- release and branch metadata
- CI failure triage

When `gh` cannot read secret values by design, verify presence or workflow
failure behavior. Never ask for a secret value to be pasted into a prompt or
checked into the repo.

## Environment Strategy

V2 environments should be modeled explicitly:

| Environment | Purpose | Provisioning posture |
| --- | --- | --- |
| `local` | Developer testing | Supabase CLI logged in; local or linked project |
| `preview` | PR/branch validation | Optional Supabase branch or shared preview project |
| `staging` | Release validation | Terraform/Tactonic managed |
| `prod` | Customer production | Terraform/Tactonic managed with approvals |

Each environment must have clear ownership, cost controls, and teardown rules.

## Migration Relationship

V1 Cloudflare resources remain live while V2 is introduced. Provisioning tasks
must avoid destructive replacement of existing Workers, D1 databases, R2
buckets, Durable Object namespaces, or Queues unless a migration plan says so.

The first V2 provisioning task should add Supabase/Tactonic support side-by-side
with the current Cloudflare deployment path.

## Acceptance Criteria

- V2 specs name `SUPABASE_API_KEY` as the canonical Actions secret for
  Supabase provisioning.
- Local development assumes the Supabase CLI is already logged in.
- Orchestrator and worker tasks know they may use authenticated `gh`,
  `wrangler`, and `supabase` directly.
- A Tactonic Terraform component type exists or is introduced for Supabase
  database provisioning.
- Terraform provisions Supabase project/database resources, while `packages/db`
  owns application migrations.
- CI provisioning performs plan before apply and redacts secrets.
- Cloudflare deploy and Hyperdrive binding updates are verified with
  `wrangler` or existing Cloudflare REST workflows.
