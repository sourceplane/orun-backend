import type { DbClient } from "@orun/db/runtime";
import { makeProjectStore } from "@orun/db/runtime";
import { isUuid, isValidSlug } from "@orun/db/runtime";
import type { RequestContextV2 } from "../../auth/v2";
import { requireOrgPermission, requireProjectPermission } from "../../auth/v2";
import { json, errorJson } from "../../http";
import { OrunError } from "../../auth/errors";
import type { V2ProjectSummary } from "@orun/types";

function toProjectSummary(p: {
  id: string; organization_id: string; slug: string; name: string;
  description: string | null; lifecycle_status: string; created_at: Date; updated_at: Date;
}): V2ProjectSummary {
  return {
    id: p.id,
    organizationId: p.organization_id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    lifecycleStatus: p.lifecycle_status,
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
  };
}

export async function handleCreateProject(
  request: Request,
  ctx: RequestContextV2,
  db: DbClient,
  orgId: string,
): Promise<Response> {
  if (!isUuid(orgId)) return errorJson("INVALID_REQUEST", "Invalid org ID", 400);

  await requireOrgPermission(ctx, orgId, "project.create", db);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const { name, slug, description } = body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    return errorJson("INVALID_REQUEST", "name is required", 400);
  }
  if (typeof slug !== "string" || !isValidSlug(slug)) {
    return errorJson("INVALID_REQUEST", "slug must be lowercase alphanumeric with hyphens (max 63 chars)", 400);
  }

  const projectStore = makeProjectStore(db);
  try {
    const project = await projectStore.createProject({
      organization_id: orgId,
      slug,
      name: name.trim(),
      description: typeof description === "string" ? description : null,
      created_by_user_id: ctx.userId!,
    });
    return json(toProjectSummary(project), 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return errorJson("CONFLICT", "Project slug already exists in this organization", 409);
    }
    if (err instanceof Error && err.message === "INVALID_SLUG") {
      return errorJson("INVALID_REQUEST", "Invalid slug", 400);
    }
    if (err instanceof Error && err.message === "INVALID_NAME") {
      return errorJson("INVALID_REQUEST", "Invalid name", 400);
    }
    throw err;
  }
}

export async function handleListProjects(
  request: Request,
  ctx: RequestContextV2,
  db: DbClient,
  orgId: string,
): Promise<Response> {
  if (!isUuid(orgId)) return errorJson("INVALID_REQUEST", "Invalid org ID", 400);

  await requireOrgPermission(ctx, orgId, "org.view", db);

  const projectStore = makeProjectStore(db);
  const projects = await projectStore.listProjects(orgId);
  return json({ projects: projects.map(toProjectSummary) });
}

export async function handleGetProject(
  request: Request,
  ctx: RequestContextV2,
  db: DbClient,
  orgId: string,
  projectId: string,
): Promise<Response> {
  if (!isUuid(orgId)) return errorJson("INVALID_REQUEST", "Invalid org ID", 400);
  if (!isUuid(projectId)) return errorJson("INVALID_REQUEST", "Invalid project ID", 400);

  await requireProjectPermission(ctx, orgId, projectId, "project.view", db);

  const projectStore = makeProjectStore(db);
  const project = await projectStore.getProject(orgId, projectId);
  if (!project) return errorJson("NOT_FOUND", "Project not found", 404);
  return json(toProjectSummary(project));
}
