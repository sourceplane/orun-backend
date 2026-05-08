# Spec V2-02 - Authentication And Authorization

## Scope

This spec defines V2 auth for dashboard users, CLI users, GitHub Actions
workloads, service/admin operations, organization membership, roles, invites,
and request authorization.

## Auth Modes

| Mode | Used by | Identity source | Authorization source |
| --- | --- | --- | --- |
| Supabase session | Dashboard | Supabase Auth GitHub provider | Postgres org membership |
| CLI access token | Local CLI | Orun token backed by GitHub user identity | Postgres org membership and repo access |
| GitHub OIDC | GitHub Actions | GitHub Actions OIDC JWT | Postgres repository binding |
| Deploy token | Bootstrap only | Worker secret | Explicitly limited bootstrap routes |
| Service token | Internal jobs/webhooks | Signed Orun token or platform secret | Narrow service policy |

## Request Context

All authenticated routes resolve to:

```typescript
interface RequestContextV2 {
  authKind: "dashboard" | "cli" | "github_oidc" | "deploy" | "service";
  actorType: "user" | "workload" | "system";
  userId?: string;
  githubUserId?: string;
  githubLogin?: string;
  organizationId?: string;
  projectId?: string;
  repositoryId?: string;
  githubRepositoryId?: string;
  roles: string[];
  permissions: string[];
  actorLabel: string;
}
```

`organizationId` must be resolved before any tenant-owned read/write.

## Dashboard Authentication

Dashboard users authenticate with Supabase Auth using GitHub provider.

Flow:

```text
Dashboard -> Supabase Auth GitHub OAuth
Supabase -> Dashboard with session
Dashboard -> Worker Authorization: Bearer <Supabase access JWT>
Worker -> verify Supabase JWT
Worker -> ensure users/user_identities rows
Worker -> resolve organizations through organization_members
```

The Worker must verify:

- JWT signature against Supabase JWKS
- issuer
- audience
- expiry
- subject

The Worker must not trust organization or role claims from the browser unless
those claims are rechecked against Postgres.

## Supabase User Sync

On every valid dashboard request, or lazily during `/v2/me`, ensure:

- `users.id = auth.sub`
- `users.email`
- `user_identities(provider='github', provider_user_id, provider_login)` when
  GitHub identity is present

Do not store GitHub OAuth access tokens.

## CLI Authentication

The CLI keeps an Orun-issued access/refresh model because GitHub Actions OIDC is
not available on local machines and Supabase GitHub OAuth does not solve every
headless terminal flow.

Supported CLI login:

```text
orun auth login
orun auth login --device
```

Backend-mediated GitHub device flow remains acceptable for CLI. On success:

- resolve or create `users`
- resolve or create `user_identities(provider='github')`
- store hashed refresh token in Postgres `cli_sessions`
- issue short-lived Orun CLI access JWT

CLI access JWT claims:

```typescript
interface CliAccessClaimsV2 {
  sub: string;              // user_id
  githubUserId: string;
  githubLogin: string;
  sessionKind: "cli";
  tokenUse: "access";
  iat: number;
  exp: number;
}
```

Do not bake broad repo permission lists into CLI access tokens as the source of
truth. Resolve org/project/repo access from Postgres when a CLI request is made.

Refresh tokens:

- opaque random string
- shown once
- stored by CLI in OS credential store where possible
- stored hashed in Postgres
- revocable
- rotatable in a future task

## GitHub Actions OIDC

GitHub Actions OIDC remains the workload identity for canonical CI writes.

Worker verifies:

- JWT signature against GitHub JWKS
- issuer `https://token.actions.githubusercontent.com`
- configured audience
- expiry and issued-at
- required claims:
  - `repository`
  - `repository_id`
  - `repository_owner`
  - `repository_owner_id`
  - `actor`

Then Worker resolves:

```sql
select r.*
from repositories r
where r.github_repository_id = $1
  and r.active = true
  and r.deleted_at is null;
```

If exactly one active repository binding exists, the request context gets:

- `organizationId`
- `projectId`
- `repositoryId`
- `githubRepositoryId`
- `actorLabel = claims.actor`

If zero bindings exist:

- `POST /v2/catalog/sync` returns `FORBIDDEN` or `NOT_FOUND` with onboarding
  guidance.
- V1 compatibility may fall back to namespace-only behavior until migration
  cutover.

If more than one active binding exists:

- reject unless the request includes explicit signed org/project context that
  can be validated against the repository binding.

MVP recommendation: enforce global uniqueness for active GitHub repository
bindings to avoid ambiguity.

## Organization Authorization

Authorization is based on:

- active organization membership
- role
- project membership overrides when later introduced
- repository binding
- policy/entitlement checks

Minimum roles:

- `owner`
- `admin`
- `member`
- `viewer`

Permissions:

| Permission | Owner | Admin | Member | Viewer |
| --- | --- | --- | --- | --- |
| `org.view` | yes | yes | yes | yes |
| `org.update` | yes | yes | no | no |
| `org.delete` | yes | no | no | no |
| `members.view` | yes | yes | yes | no |
| `members.manage` | yes | yes | no | no |
| `billing.manage` | yes | no | no | no |
| `github.connect` | yes | yes | no | no |
| `project.create` | yes | yes | yes | no |
| `project.update` | yes | yes | conditional | no |
| `catalog.view` | yes | yes | yes | yes |
| `run.view` | yes | yes | yes | yes |
| `run.trigger` | yes | yes | yes | no |
| `policy.view` | yes | yes | yes | yes |
| `policy.edit` | yes | yes | no | no |

`conditional` means product policy may allow project creators or project admins
later. Do not add hidden project roles in the first V2 slice.

## Authorization Helpers

Worker handlers should call service-level guards:

```typescript
await authz.requireOrgPermission(ctx, orgId, "catalog.view");
await authz.requireProjectPermission(ctx, orgId, projectId, "run.trigger");
await authz.requireRepositoryAccess(ctx, orgId, projectId, repositoryId, "write");
```

These helpers query Postgres and return a typed `AuthorizedScope`.

Handlers must not manually reconstruct role rules.

## Invite Flow

Create invite:

```text
POST /v2/organizations/:orgId/invites
requires members.manage
body { email, role }
```

Rules:

- role must be lower or equal to inviter's allowed grant level
- invite token stored only as hash
- invite has expiry
- audit event created
- repeated active invite for same email may return existing invite

Accept invite:

```text
POST /v2/invites/:inviteId/accept
Authorization: Supabase session
body { token }
```

Rules:

- hash token and compare
- ensure not expired/revoked/accepted
- create or update `organization_members`
- set accepted fields
- audit event created

## GitHub App Authorization

Connect GitHub:

- requires `github.connect`
- starts GitHub App install flow
- callback records `github_installations`
- installation repositories can then be attached to projects

Repository selection:

- requires `github.connect`
- selected repository must belong to installation
- repository row is created or updated in Postgres
- audit event created

Do not ask for a personal GitHub token in dashboard SaaS flows.

## Dashboard Session Authorization

Dashboard sessions are read/write for product management actions based on org
role, but they must not directly mutate live job coordination state.

Forbidden for dashboard sessions:

- claim job
- heartbeat job
- update job status
- upload runner logs

Allowed with permission:

- create organization
- invite members
- connect GitHub
- create project
- view catalog
- view runs/logs
- request approved run dispatch when that feature exists

Dashboard-triggered runs must use a separate dispatch model. The dashboard may
request a run, but a trusted workload identity must execute it.

## CLI Authorization

CLI sessions may:

- create local/dev runs under user-owned local scope
- read organization resources where the user is a member
- trigger approved remote actions if role permits

CLI sessions must not write canonical CI run state unless a specific dispatch
contract is implemented.

During migration, local namespace behavior can continue for compatibility, but
new V2 org/project commands should use explicit org and project context.

## Service Tokens

Service tokens are for:

- queue consumers
- scheduled cleanup
- webhook processors
- internal projection rebuilders

They must be scoped narrowly. A service token must identify:

- service name
- allowed actions
- expiry or rotation model

Do not reuse deploy token for runtime service auth.

## Audit Requirements

Create audit events for:

- organization creation
- membership changes
- invite creation, acceptance, revocation
- GitHub installation linkage
- repository linkage/unlinkage
- billing changes
- policy changes
- run dispatch requests
- destructive actions

Audit events should include actor, resource, action, metadata, and timestamp.

## Compatibility With V1 Auth

V1 HMAC dashboard sessions and `allowedNamespaceIds` may remain during migration.
When used against V2 services, map them to a personal/default organization and
resolve repository rows from old D1 namespace/account state or the Postgres
backfill.

Do not add new V2-only functionality to V1 session tokens.

## Acceptance Criteria

- Dashboard auth verifies Supabase JWTs.
- User profile and GitHub identity rows are created lazily.
- Organization membership controls all tenant reads and writes.
- CLI refresh sessions are stored in Postgres.
- GitHub OIDC resolves to an unambiguous repository/project/org.
- Dashboard sessions cannot use live runner mutation routes.
- Invite tokens are stored only as hashes.
- Role checks are centralized.
