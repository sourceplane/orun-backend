-- V2 core schema: users, organizations, membership, billing, entitlements, projects
-- RLS policies are deferred to the V2 auth/authorization task.

create extension if not exists "pgcrypto";

-- updated_at maintenance
create or replace function orun_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- users
-- id matches Supabase Auth UUID; no gen_random_uuid() default here
-- ----------------------------------------------------------------------------
create table users (
  id           uuid        primary key,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger trg_users_updated_at
  before update on users
  for each row execute function orun_set_updated_at();

-- ----------------------------------------------------------------------------
-- user_identities
-- ----------------------------------------------------------------------------
create table user_identities (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references users(id),
  provider         text        not null,
  provider_user_id text        not null,
  provider_login   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (provider, provider_user_id),
  unique (user_id, provider)
);

create trigger trg_user_identities_updated_at
  before update on user_identities
  for each row execute function orun_set_updated_at();

-- ----------------------------------------------------------------------------
-- organizations
-- ----------------------------------------------------------------------------
create table organizations (
  id                  uuid        primary key default gen_random_uuid(),
  slug                text        not null unique,
  name                text        not null,
  created_by_user_id  uuid        references users(id),
  provisioning_mode   text        not null default 'shared',
  lifecycle_status    text        not null default 'active',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  check (provisioning_mode in ('shared', 'dedicated_schema', 'dedicated_database')),
  check (lifecycle_status in ('active', 'suspended', 'deleted'))
);

create trigger trg_organizations_updated_at
  before update on organizations
  for each row execute function orun_set_updated_at();

-- ----------------------------------------------------------------------------
-- organization_members
-- ----------------------------------------------------------------------------
create table organization_members (
  organization_id    uuid        not null references organizations(id),
  user_id            uuid        not null references users(id),
  role               text        not null,
  status             text        not null default 'active',
  invited_by_user_id uuid        references users(id),
  joined_at          timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  primary key (organization_id, user_id),
  check (role in ('owner', 'admin', 'member', 'viewer')),
  check (status in ('active', 'disabled'))
);

create index idx_org_members_org on organization_members(organization_id);

create trigger trg_organization_members_updated_at
  before update on organization_members
  for each row execute function orun_set_updated_at();

-- ----------------------------------------------------------------------------
-- organization_invites
-- ----------------------------------------------------------------------------
create table organization_invites (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null references organizations(id),
  email                text        not null,
  role                 text        not null,
  token_hash           text        not null unique,
  invited_by_user_id   uuid        not null references users(id),
  accepted_by_user_id  uuid        references users(id),
  accepted_at          timestamptz,
  expires_at           timestamptz not null,
  revoked_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (role in ('owner', 'admin', 'member', 'viewer'))
);

create index idx_org_invites_org   on organization_invites(organization_id, created_at desc);
create index idx_org_invites_email on organization_invites(lower(email));

create trigger trg_organization_invites_updated_at
  before update on organization_invites
  for each row execute function orun_set_updated_at();

-- ----------------------------------------------------------------------------
-- billing_accounts
-- ----------------------------------------------------------------------------
create table billing_accounts (
  id                   uuid        primary key default gen_random_uuid(),
  organization_id      uuid        not null unique references organizations(id),
  provider             text        not null default 'stripe',
  provider_customer_id text,
  plan                 text        not null default 'free',
  status               text        not null default 'active',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (provider in ('stripe', 'manual')),
  check (plan in ('free', 'pro', 'team', 'enterprise')),
  check (status in ('active', 'past_due', 'cancelled', 'trialing'))
);

create trigger trg_billing_accounts_updated_at
  before update on billing_accounts
  for each row execute function orun_set_updated_at();

-- ----------------------------------------------------------------------------
-- entitlements
-- ----------------------------------------------------------------------------
create table entitlements (
  organization_id uuid        not null references organizations(id),
  key             text        not null,
  value           jsonb       not null,
  source          text        not null default 'system',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, key)
);

create trigger trg_entitlements_updated_at
  before update on entitlements
  for each row execute function orun_set_updated_at();

-- ----------------------------------------------------------------------------
-- projects
-- ----------------------------------------------------------------------------
create table projects (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references organizations(id),
  slug                text        not null,
  name                text        not null,
  description         text,
  default_branch      text,
  lifecycle_status    text        not null default 'active',
  created_by_user_id  uuid        references users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  unique (organization_id, slug),
  check (lifecycle_status in ('active', 'archived', 'deleted'))
);

create index idx_projects_org on projects(organization_id, created_at desc);

create trigger trg_projects_updated_at
  before update on projects
  for each row execute function orun_set_updated_at();
