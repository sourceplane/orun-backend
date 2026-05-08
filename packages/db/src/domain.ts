// TypeScript row types for tables created in 0001_core.sql.
// These are plain data shapes — no ORM, no runtime behaviour.

export interface UserRow {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserIdentityRow {
  id: string;
  user_id: string;
  provider: string;
  provider_user_id: string;
  provider_login: string | null;
  created_at: Date;
  updated_at: Date;
}

export type ProvisioningMode = "shared" | "dedicated_schema" | "dedicated_database";
export type OrgLifecycleStatus = "active" | "suspended" | "deleted";

export interface OrganizationRow {
  id: string;
  slug: string;
  name: string;
  created_by_user_id: string | null;
  provisioning_mode: ProvisioningMode;
  lifecycle_status: OrgLifecycleStatus;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type MemberStatus = "active" | "disabled";

export interface OrganizationMemberRow {
  organization_id: string;
  user_id: string;
  role: MemberRole;
  status: MemberStatus;
  invited_by_user_id: string | null;
  joined_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface OrganizationInviteRow {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  token_hash: string;
  invited_by_user_id: string;
  accepted_by_user_id: string | null;
  accepted_at: Date | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type BillingProvider = "stripe" | "manual";
export type BillingPlan = "free" | "pro" | "team" | "enterprise";
export type BillingStatus = "active" | "past_due" | "cancelled" | "trialing";

export interface BillingAccountRow {
  id: string;
  organization_id: string;
  provider: BillingProvider;
  provider_customer_id: string | null;
  plan: BillingPlan;
  status: BillingStatus;
  created_at: Date;
  updated_at: Date;
}

export interface EntitlementRow {
  organization_id: string;
  key: string;
  value: unknown;
  source: string;
  created_at: Date;
  updated_at: Date;
}

export type ProjectLifecycleStatus = "active" | "archived" | "deleted";

export interface ProjectRow {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  description: string | null;
  default_branch: string | null;
  lifecycle_status: ProjectLifecycleStatus;
  created_by_user_id: string | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

// Input types for insert operations (id/created_at/updated_at are DB-generated)

export type CreateUserInput = Pick<UserRow, "id" | "email" | "display_name" | "avatar_url">;

export type CreateUserIdentityInput = Pick<
  UserIdentityRow,
  "user_id" | "provider" | "provider_user_id" | "provider_login"
>;

export type CreateOrganizationInput = Pick<
  OrganizationRow,
  "slug" | "name" | "created_by_user_id" | "provisioning_mode"
>;

export type CreateOrganizationMemberInput = Pick<
  OrganizationMemberRow,
  "organization_id" | "user_id" | "role" | "invited_by_user_id"
>;

export type CreateOrganizationInviteInput = Pick<
  OrganizationInviteRow,
  | "organization_id"
  | "email"
  | "role"
  | "token_hash"
  | "invited_by_user_id"
  | "expires_at"
>;

export type CreateProjectInput = Pick<
  ProjectRow,
  "organization_id" | "slug" | "name" | "description" | "default_branch" | "created_by_user_id"
>;
