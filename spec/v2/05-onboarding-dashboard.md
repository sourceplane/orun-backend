# Spec V2-05 - Onboarding And Dashboard Product Surface

## Scope

This spec defines the V2 user onboarding flow and dashboard information
architecture for multi-organization Orun SaaS.

The dashboard remains a dense operational product surface. It is not a
marketing page.

## First-Run Flow

Recommended first-time flow:

```text
Sign in with GitHub
  -> create/sync user profile
  -> create organization
  -> create project
  -> connect GitHub App
  -> select repository
  -> run first Orun plan/catalog sync
  -> invite members
```

The product may skip project creation as a separate step if repo selection
creates a project from the repo. The organization step must not be skipped.

## Onboarding State

`GET /v2/organizations/:orgId` returns onboarding state:

```typescript
interface OnboardingState {
  hasOrganization: boolean;
  hasProject: boolean;
  hasGitHubInstallation: boolean;
  hasRepository: boolean;
  hasCatalogData: boolean;
  hasInvitedMembers: boolean;
  nextStep:
    | "create_organization"
    | "create_project"
    | "connect_github"
    | "select_repository"
    | "generate_catalog"
    | "invite_members"
    | "complete";
}
```

The dashboard should show the next actionable setup state without using
marketing-style hero sections.

## Authenticated Shell

Required shell:

- left navigation
- organization switcher
- project selector where relevant
- user menu
- compact global search
- refresh affordance
- routeable URLs

Primary navigation:

- Catalog
- Runs
- Projects
- Repositories
- Members
- Policies
- Settings

Billing can appear in Settings for early V2.

## Organization Switcher

After sign-in, dashboard calls `/v2/me` and renders organizations:

```text
Switch Organization
  Sourceplane
  Personal
  Acme Platform
```

If no organization exists:

- show create organization view
- do not show catalog/runs empty states yet

If exactly one organization exists:

- select it automatically

If multiple exist:

- restore last selected organization from session storage if still valid
- otherwise select most recent active organization

## Create Organization View

Fields:

- organization name
- organization slug

On submit:

- call `POST /v2/organizations`
- switch into new organization
- navigate to project/repo setup

Created side effects:

- owner membership
- billing placeholder
- default policy set
- audit event

## Project Setup

Two valid MVP paths:

### Explicit project creation

1. Create organization.
2. Ask for project name.
3. Connect GitHub.
4. Select repository into project.

### Repository-first project creation

1. Create organization.
2. Connect GitHub.
3. Select repository.
4. Create project from selected repository.

Preferred first implementation: explicit project creation. It makes the product
model visible and avoids confusing repo equals project semantics.

## GitHub Connection

Dashboard must use GitHub App install flow:

```text
Connect GitHub
  -> GitHub App install/authorize
  -> callback
  -> repository selection
```

Do not ask users to paste a GitHub personal access token.

Repository selection screen:

- list installation repositories
- show repo full name
- show visibility
- select target project
- attach repository

## Catalog Home

Primary landing view after setup.

Required filters:

- project
- repository
- owner
- type
- status
- free-text search

Required columns:

- component name/title
- type
- project
- repository
- owner/team
- system/domain
- lifecycle
- status
- latest commit
- latest plan checksum
- last seen

Empty states:

- no projects
- no repositories
- repository linked but no catalog sync yet
- filters produce no matches
- API/auth error

## Component Detail

Required sections:

- Overview
- Runs
- Dependencies
- History
- Environments
- Raw artifacts

Overview fields:

- name/title
- type
- project
- repository
- path
- owner
- system
- lifecycle
- tags
- latest commit
- latest plan checksum
- current status
- last synced

Actions are deferred unless backed by an approved dispatch contract.

## Runs

Run list filters:

- project
- repository
- component
- status
- trigger
- actor
- date range

Run detail:

- status
- project/repository
- actor
- trigger
- plan checksum
- jobs grouped by component
- logs
- timestamps

Dashboard may view logs but may not upload logs or mutate job state.

## Projects

Project list:

- name
- slug
- repository count
- component count
- latest run status
- last catalog sync

Project detail:

- repositories
- components
- recent runs
- policies
- settings

## Repositories

Repository list:

- project
- full name
- GitHub repository ID
- installation
- linked timestamp
- last seen
- component count
- last sync
- sync status

Repository actions:

- attach repository to project
- detach repository from project
- refresh installation repository list

Detach requires admin/owner and must not delete historical runs by default.

## Members

Members view:

- active members
- role
- joined date
- invited by
- status

Invite member:

- email
- role

Safety:

- cannot remove last owner
- cannot grant owner/admin unless caller can grant that role

## Settings

Organization settings:

- organization name/slug
- billing summary
- GitHub installations
- retention settings when available
- danger zone for archive/delete

User settings:

- GitHub identity
- CLI sessions
- sign out

## URL Model

Use routeable URLs:

```text
/orgs/:orgSlug/catalog
/orgs/:orgSlug/catalog/components/:componentId
/orgs/:orgSlug/runs
/orgs/:orgSlug/runs/:runId
/orgs/:orgSlug/projects
/orgs/:orgSlug/projects/:projectId
/orgs/:orgSlug/repositories
/orgs/:orgSlug/members
/orgs/:orgSlug/settings
```

Hash routing may remain during incremental migration, but V2 should aim for
proper browser routes if Cloudflare Pages config supports it.

## Client State

Recommended state boundaries:

- auth session
- current user and org memberships
- selected organization
- selected project filter
- feature data loaded per view

Do not create a heavy global state framework until needed.

## Compatibility With Current Dashboard

Current dashboard concepts map as:

| Current UI | V2 UI |
| --- | --- |
| GitHub login only | Supabase/GitHub login |
| Account notice | Create organization onboarding |
| Linked repositories count | Org/project repository scope |
| Catalog global list | Org-scoped catalog |
| Runs global list | Org/project-scoped runs |
| Settings account ID | Organization, user, CLI sessions, billing |

## Acceptance Criteria

- First-time user can create an organization.
- Organization owner sees onboarding next step.
- User can create a project.
- User can connect GitHub App.
- User can attach a repository to a project.
- Catalog and run views are org-scoped.
- Organization switcher works.
- Members/invites surface exists or is explicitly deferred behind route flag.
- Dashboard does not ask for GitHub PATs.
- Dashboard cannot mutate live runner job state.
