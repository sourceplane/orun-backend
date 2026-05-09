import type { DbClient } from "./types.js";
import type { ProjectRow } from "./domain.js";
import { isValidSlug } from "./ids.js";

export interface ProjectSummary {
  id: string;
  organization_id: string;
  slug: string;
  name: string;
  description: string | null;
  lifecycle_status: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectParams {
  organization_id: string;
  slug: string;
  name: string;
  description?: string | null;
  created_by_user_id: string;
}

export interface ProjectStore {
  createProject(params: CreateProjectParams): Promise<ProjectSummary>;
  listProjects(orgId: string): Promise<ProjectSummary[]>;
  getProject(orgId: string, projectId: string): Promise<ProjectSummary | null>;
}

export function makeProjectStore(db: DbClient): ProjectStore {
  return {
    async createProject({ organization_id, slug, name, description, created_by_user_id }) {
      if (!isValidSlug(slug)) throw new Error("INVALID_SLUG");
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("INVALID_NAME");

      const { rows } = await db.query<ProjectRow>(
        `INSERT INTO projects
           (organization_id, slug, name, description, created_by_user_id, lifecycle_status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING *`,
        [organization_id, slug, trimmedName, description ?? null, created_by_user_id],
      );
      if (!rows[0]) throw new Error("createProject: insert returned no rows");
      return rowToSummary(rows[0]);
    },

    async listProjects(orgId) {
      const { rows } = await db.query<ProjectRow>(
        `SELECT * FROM projects
         WHERE organization_id = $1 AND lifecycle_status != 'deleted'
         ORDER BY created_at ASC`,
        [orgId],
      );
      return rows.map(rowToSummary);
    },

    async getProject(orgId, projectId) {
      const { rows } = await db.query<ProjectRow>(
        `SELECT * FROM projects
         WHERE organization_id = $1 AND id = $2 AND lifecycle_status != 'deleted'`,
        [orgId, projectId],
      );
      return rows[0] ? rowToSummary(rows[0]) : null;
    },
  };
}

function rowToSummary(proj: ProjectRow): ProjectSummary {
  return {
    id: proj.id,
    organization_id: proj.organization_id,
    slug: proj.slug,
    name: proj.name,
    description: proj.description,
    lifecycle_status: proj.lifecycle_status,
    created_at: proj.created_at,
    updated_at: proj.updated_at,
  };
}
