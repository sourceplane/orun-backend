import type { DbClient } from "./types.js";
import type { OrganizationRow, OrganizationMemberRow, MemberRole } from "./domain.js";
import { isValidSlug } from "./ids.js";

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  lifecycle_status: string;
  created_at: Date;
  updated_at: Date;
}

export interface OrgDetail extends OrgSummary {
  billing_plan: string;
  billing_status: string;
}

export interface OrgMembership {
  organization: OrgSummary;
  role: MemberRole;
  member_status: string;
}

export interface CreateOrgParams {
  name: string;
  slug: string;
  createdByUserId: string;
}

export interface OrgStore {
  createOrganization(params: CreateOrgParams): Promise<OrgSummary>;
  listOrgsForUser(userId: string): Promise<OrgMembership[]>;
  getOrganization(orgId: string, userId: string): Promise<{ org: OrgSummary; membership: OrganizationMemberRow } | null>;
  getOrgDetail(orgId: string, userId: string): Promise<{ org: OrgDetail; membership: OrganizationMemberRow } | null>;
  getMembership(orgId: string, userId: string): Promise<OrganizationMemberRow | null>;
}

const DEFAULT_ENTITLEMENTS: [string, unknown][] = [
  ["max_projects", 5],
  ["max_members", 10],
  ["run_concurrency", 2],
  ["retention_days", 30],
];

export function makeOrgStore(db: DbClient): OrgStore {
  return {
    async createOrganization({ name, slug, createdByUserId }) {
      if (!isValidSlug(slug)) throw new Error("INVALID_SLUG");
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("INVALID_NAME");

      return db.transaction(async (tx) => {
        const { rows: orgRows } = await tx.query<OrganizationRow>(
          `INSERT INTO organizations (slug, name, created_by_user_id, provisioning_mode, lifecycle_status)
           VALUES ($1, $2, $3, 'shared', 'active')
           RETURNING *`,
          [slug, trimmedName, createdByUserId],
        );
        if (!orgRows[0]) throw new Error("createOrganization: insert returned no rows");
        const org = orgRows[0];

        await tx.query(
          `INSERT INTO organization_members
             (organization_id, user_id, role, status, joined_at)
           VALUES ($1, $2, 'owner', 'active', now())`,
          [org.id, createdByUserId],
        );

        await tx.query(
          `INSERT INTO billing_accounts (organization_id, provider, plan, status)
           VALUES ($1, 'manual', 'free', 'active')`,
          [org.id],
        );

        for (const [key, value] of DEFAULT_ENTITLEMENTS) {
          await tx.query(
            `INSERT INTO entitlements (organization_id, key, value, source)
             VALUES ($1, $2, $3::jsonb, 'system')`,
            [org.id, key, JSON.stringify(value)],
          );
        }

        return {
          id: org.id,
          slug: org.slug,
          name: org.name,
          lifecycle_status: org.lifecycle_status,
          created_at: org.created_at,
          updated_at: org.updated_at,
        };
      });
    },

    async listOrgsForUser(userId) {
      const { rows } = await db.query<OrganizationRow & { role: MemberRole; member_status: string }>(
        `SELECT o.*, om.role, om.status AS member_status
         FROM organizations o
         JOIN organization_members om ON om.organization_id = o.id
         WHERE om.user_id = $1
           AND om.status = 'active'
           AND o.lifecycle_status != 'deleted'
         ORDER BY o.created_at ASC`,
        [userId],
      );
      return rows.map((row) => ({
        organization: {
          id: row.id,
          slug: row.slug,
          name: row.name,
          lifecycle_status: row.lifecycle_status,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
        role: row.role,
        member_status: row.member_status,
      }));
    },

    async getOrganization(orgId, userId) {
      const { rows: orgRows } = await db.query<OrganizationRow>(
        `SELECT * FROM organizations WHERE id = $1 AND lifecycle_status != 'deleted'`,
        [orgId],
      );
      if (!orgRows[0]) return null;

      const { rows: memberRows } = await db.query<OrganizationMemberRow>(
        `SELECT * FROM organization_members
         WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
        [orgId, userId],
      );
      if (!memberRows[0]) return null;

      const org = orgRows[0];
      return {
        org: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          lifecycle_status: org.lifecycle_status,
          created_at: org.created_at,
          updated_at: org.updated_at,
        },
        membership: memberRows[0],
      };
    },

    async getOrgDetail(orgId, userId) {
      const { rows: orgRows } = await db.query<OrganizationRow>(
        `SELECT * FROM organizations WHERE id = $1 AND lifecycle_status != 'deleted'`,
        [orgId],
      );
      if (!orgRows[0]) return null;

      const { rows: memberRows } = await db.query<OrganizationMemberRow>(
        `SELECT * FROM organization_members
         WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
        [orgId, userId],
      );
      if (!memberRows[0]) return null;

      const { rows: billingRows } = await db.query<{ plan: string; status: string }>(
        `SELECT plan, status FROM billing_accounts WHERE organization_id = $1`,
        [orgId],
      );

      const org = orgRows[0];
      return {
        org: {
          id: org.id,
          slug: org.slug,
          name: org.name,
          lifecycle_status: org.lifecycle_status,
          created_at: org.created_at,
          updated_at: org.updated_at,
          billing_plan: billingRows[0]?.plan ?? "free",
          billing_status: billingRows[0]?.status ?? "active",
        },
        membership: memberRows[0],
      };
    },

    async getMembership(orgId, userId) {
      const { rows } = await db.query<OrganizationMemberRow>(
        `SELECT * FROM organization_members
         WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`,
        [orgId, userId],
      );
      return rows[0] ?? null;
    },
  };
}
