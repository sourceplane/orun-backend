import type { DbClient } from "@orun/db/runtime";
import { makeOrgStore } from "@orun/db/runtime";
import { isUuid, isValidSlug } from "@orun/db/runtime";
import type { RequestContextV2 } from "../../auth/v2";
import { requireOrgPermission, permissionsForRole } from "../../auth/v2";
import { json, errorJson } from "../../http";
import { OrunError } from "../../auth/errors";
import type { V2OrgSummary, V2OrgDetail } from "@orun/types";

export async function handleCreateOrg(
  request: Request,
  ctx: RequestContextV2,
  db: DbClient,
): Promise<Response> {
  if (!ctx.userId) throw new OrunError("UNAUTHORIZED", "User identity required");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const { name, slug } = body as Record<string, unknown>;
  if (typeof name !== "string" || !name.trim()) {
    return errorJson("INVALID_REQUEST", "name is required", 400);
  }
  if (typeof slug !== "string" || !isValidSlug(slug)) {
    return errorJson("INVALID_REQUEST", "slug must be lowercase alphanumeric with hyphens (max 63 chars)", 400);
  }

  const orgStore = makeOrgStore(db);
  try {
    const org = await orgStore.createOrganization({
      name: name.trim(),
      slug,
      createdByUserId: ctx.userId,
    });

    const response: V2OrgSummary = {
      id: org.id,
      slug: org.slug,
      name: org.name,
      lifecycleStatus: org.lifecycle_status,
      createdAt: org.created_at.toISOString(),
      updatedAt: org.updated_at.toISOString(),
    };
    return json(response, 201);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("duplicate key")) {
      return errorJson("CONFLICT", "Organization slug already exists", 409);
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

export async function handleListOrgs(
  request: Request,
  ctx: RequestContextV2,
  db: DbClient,
): Promise<Response> {
  if (!ctx.userId) throw new OrunError("UNAUTHORIZED", "User identity required");

  const orgStore = makeOrgStore(db);
  const memberships = await orgStore.listOrgsForUser(ctx.userId);

  return json({
    organizations: memberships.map((m) => ({
      id: m.organization.id,
      slug: m.organization.slug,
      name: m.organization.name,
      lifecycleStatus: m.organization.lifecycle_status,
      createdAt: m.organization.created_at.toISOString(),
      updatedAt: m.organization.updated_at.toISOString(),
      role: m.role,
      permissions: permissionsForRole(m.role),
    })),
  });
}

export async function handleGetOrg(
  request: Request,
  ctx: RequestContextV2,
  db: DbClient,
  orgId: string,
): Promise<Response> {
  if (!isUuid(orgId)) return errorJson("INVALID_REQUEST", "Invalid org ID", 400);

  await requireOrgPermission(ctx, orgId, "org.view", db);

  const orgStore = makeOrgStore(db);
  const result = await orgStore.getOrgDetail(orgId, ctx.userId!);
  if (!result) return errorJson("NOT_FOUND", "Organization not found", 404);

  const { org } = result;
  const response: V2OrgDetail = {
    id: org.id,
    slug: org.slug,
    name: org.name,
    lifecycleStatus: org.lifecycle_status,
    createdAt: org.created_at.toISOString(),
    updatedAt: org.updated_at.toISOString(),
    billingPlan: org.billing_plan,
    billingStatus: org.billing_status,
  };
  return json(response);
}
