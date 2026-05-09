import type { DbClient } from "@orun/db/runtime";
import { makeUserStore, makeOrgStore } from "@orun/db/runtime";
import type { RequestContextV2 } from "../../auth/v2";
import { json, errorJson } from "../../http";
import { OrunError } from "../../auth/errors";
import type { V2MeResponse } from "@orun/types";
import { permissionsForRole } from "../../auth/v2";

export async function handleV2Me(
  request: Request,
  ctx: RequestContextV2,
  db: DbClient,
): Promise<Response> {
  if (!ctx.userId) {
    throw new OrunError("UNAUTHORIZED", "User identity required");
  }

  const userStore = makeUserStore(db);
  const orgStore = makeOrgStore(db);

  const [user, memberships] = await Promise.all([
    userStore.getUserById(ctx.userId),
    orgStore.listOrgsForUser(ctx.userId),
  ]);

  if (!user) {
    throw new OrunError("NOT_FOUND", "User not found");
  }

  const response: V2MeResponse = {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      githubLogin: ctx.githubLogin ?? null,
    },
    organizations: memberships.map((m) => ({
      id: m.organization.id,
      slug: m.organization.slug,
      name: m.organization.name,
      role: m.role,
      permissions: permissionsForRole(m.role),
    })),
  };

  return json(response);
}
