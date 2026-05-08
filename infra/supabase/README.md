# infra/supabase — V2 Supabase Database Provisioning

Terraform scaffold for provisioning the Supabase/Postgres project that backs
the orun V2 data layer. Platform resources only — application DDL is owned by
`packages/db` migrations.

## Overview

| Layer | Owner | What it manages |
|---|---|---|
| `infra/supabase` (this dir) | Terraform / Tactonic | Supabase project, region, database password ref |
| `packages/db` | Migration harness | Tables, indexes, constraints, seed data |

V1 Cloudflare Workers, D1, R2, Queues, and Durable Objects are **not touched**
by this provisioning path.

## Tactonic Status

`stack-tectonic:0.12.0` does not yet export a `supabase-postgres` composition
type. This scaffold uses the generic `terraform` composition and is invoked
directly by `.github/workflows/v2-db-provision.yml`.

See `ai/proposals/task-0022-supabase-postgres-component.md` for the proposal
to add a first-class `supabase-postgres` type to stack-tectonic.

The `infra/` directory is not in `intent.yaml` discovery roots, so this
component is **not** run by `orun plan --changed`. It is on-demand only.

## Required Terraform Variables

| Variable | Source | Description |
|---|---|---|
| `environment` | workflow input | `dev`, `preview`, `staging`, or `prod` |
| `organization_slug` | hardcoded per env | Org slug for naming and tags |
| `supabase_organization_id` | Supabase dashboard | Supabase org ID (not slug) |
| `project_name` | hardcoded per env | Supabase project display name |
| `region` | hardcoded per env | Supabase region |
| `database_password_secret_ref` | secrets manager | Path/name of password secret |
| `supabase_api_key` | `SUPABASE_API_KEY` secret | Supabase Management API token |

`SUPABASE_API_KEY` is the canonical GitHub Actions secret name. The workflow
passes it as `TF_VAR_supabase_api_key` so the Terraform provider receives it
as `access_token`. The secret name in GitHub Actions never changes.

## Required GitHub Secrets

| Secret | Purpose |
|---|---|
| `SUPABASE_API_KEY` | Supabase Management API token for plan and apply |

## Remote State

Local Terraform state is acceptable only for disposable local experimentation
and is excluded by `.gitignore`. Before applying to any shared environment
(staging, prod), uncomment and configure the `backend` block in `versions.tf`
using the Tactonic-approved remote backend.

## Plan vs Apply

All provisioning follows a plan-first safety model:

1. **Plan** (`mode = plan`): Terraform shows what would change. No resources
   are created or modified. Safe to run at any time.
2. **Apply** (`mode = apply`): Creates or updates resources. Requires explicit
   `mode = apply` input and, for staging/prod, GitHub environment protection.

The `v2-db-provision.yml` workflow enforces this. `apply` can never run
without an explicit `plan` step in the same workflow invocation.

## Running Locally

```bash
cd infra/supabase

# Initialize Terraform (downloads provider)
terraform init

# Plan with explicit vars
terraform plan \
  -var="environment=dev" \
  -var="organization_slug=sourceplane" \
  -var="supabase_organization_id=<your-supabase-org-id>" \
  -var="project_name=orun-dev" \
  -var="region=us-east-1" \
  -var="database_password_secret_ref=orun/dev/database-password" \
  -var="supabase_api_key=$SUPABASE_API_KEY"
```

Do not apply to shared environments from a local machine.

## Outputs

After apply, outputs include:
- `supabase_project_ref` — project reference
- `supabase_project_url` — Supabase API URL
- `supabase_jwks_url` — JWKS URL for Worker JWT verification
- `postgres_host` / `postgres_port` / `postgres_database`
- `database_url_secret_ref` — for migration jobs only
- `hyperdrive_database_url_secret_ref` — for Hyperdrive wiring (later task)

Sensitive outputs are redacted by Terraform in logs. Workflows must not print
them.

## Running Migrations After Provisioning

Once the Supabase project is provisioned and `DATABASE_URL` is available:

```bash
DATABASE_URL="postgres://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" \
  pnpm --filter @orun/db migrate
```

Then verify with the smoke script:

```bash
DATABASE_URL="..." pnpm --filter @orun/db smoke
```

See `packages/db/README.md` for the full migration and smoke workflow.

## Environments

| Environment | Apply posture | Branching |
|---|---|---|
| `dev` | Automated after plan, no approval | Optional |
| `preview` | Automated after plan, no approval | Optional |
| `staging` | Requires GitHub environment approval | Disabled |
| `prod` | Requires GitHub environment approval | Disabled |

Production applies are blocked until environment protections and account
targeting are verified and enabled on the GitHub repository.
