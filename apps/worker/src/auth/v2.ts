import type { Env } from "@orun/types";
import type { DbClient, MemberRole } from "@orun/db/runtime";
import { makeUserStore } from "@orun/db/runtime";
import { makeOrgStore } from "@orun/db/runtime";
import { OrunError } from "./errors";
import { verifySessionToken } from "./session";
import { verifyOIDCToken, extractNamespaceFromOIDC, looksLikeOIDC } from "./oidc";
import { verifySupabaseJwt, looksLikeSupabaseJwt, type SupabaseClaims } from "./supabase";

// Permission table — maps role → set of permissions
const ROLE_PERMISSIONS: Record<MemberRole, string[]> = {
  owner: [
    "org.view", "org.update", "org.delete",
    "members.view", "members.manage",
    "billing.manage",
    "github.connect",
    "project.create", "project.view", "project.update",
    "catalog.view", "run.view", "run.trigger",
    "policy.view", "policy.edit",
  ],
  admin: [
    "org.view", "org.update",
    "members.view", "members.manage",
    "github.connect",
    "project.create", "project.view", "project.update",
    "catalog.view", "run.view", "run.trigger",
    "policy.view", "policy.edit",
  ],
  member: [
    "org.view",
    "members.view",
    "project.create", "project.view",
    "catalog.view", "run.view", "run.trigger",
    "policy.view",
  ],
  viewer: [
    "org.view",
    "project.view",
    "catalog.view", "run.view",
    "policy.view",
  ],
};

export function permissionsForRole(role: MemberRole): string[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export interface RequestContextV2 {
  authKind: "dashboard" | "cli" | "github_oidc" | "deploy";
  actorType: "user" | "workload" | "system";
  userId?: string;
  githubUserId?: string;
  githubLogin?: string;
  actorLabel: string;
  // Raw Supabase claims when authKind === "dashboard"
  supabaseClaims?: SupabaseClaims;
}

export async function authenticateV2(
  request: Request,
  env: Env,
  db: DbClient,
): Promise<RequestContextV2> {
  const deployToken = request.headers.get("X-Orun-Deploy-Token");
  if (deployToken) {
    if (!env.ORUN_DEPLOY_TOKEN || deployToken !== env.ORUN_DEPLOY_TOKEN) {
      throw new OrunError("UNAUTHORIZED", "Invalid deploy token");
    }
    return { authKind: "deploy", actorType: "system", actorLabel: "system" };
  }

  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new OrunError("UNAUTHORIZED", "Missing authorization header");
  }
  const token = auth.slice(7);

  // 1. GitHub OIDC
  if (looksLikeOIDC(token)) {
    const claims = await verifyOIDCToken(token, env);
    const ns = extractNamespaceFromOIDC(claims);
    return {
      authKind: "github_oidc",
      actorType: "workload",
      githubUserId: claims.repository_owner_id,
      actorLabel: claims.actor,
    };
  }

  // 2. Supabase JWT (dashboard)
  if (looksLikeSupabaseJwt(token, env)) {
    const claims = await verifySupabaseJwt(token, env);

    // Lazy user sync — ensure users row exists
    const userStore = makeUserStore(db);
    const meta = claims.user_metadata;
    await userStore.upsertUser({
      id: claims.sub,
      email: claims.email ?? meta?.email ?? null,
      display_name: meta?.full_name ?? meta?.name ?? null,
      avatar_url: meta?.avatar_url ?? null,
    });

    if (meta?.provider_id && meta.user_name) {
      await userStore.upsertGitHubIdentity({
        user_id: claims.sub,
        provider: "github",
        provider_user_id: meta.provider_id,
        provider_login: meta.user_name,
      });
    }

    return {
      authKind: "dashboard",
      actorType: "user",
      userId: claims.sub,
      githubUserId: meta?.provider_id,
      githubLogin: meta?.user_name,
      actorLabel: meta?.user_name ?? meta?.name ?? claims.sub,
      supabaseClaims: claims,
    };
  }

  // 3. Orun HMAC session (CLI or legacy dashboard)
  if (!env.ORUN_SESSION_SECRET) {
    throw new OrunError("UNAUTHORIZED", "No authentication method matched");
  }
  const sessionClaims = await verifySessionToken(token, env.ORUN_SESSION_SECRET);

  // Resolve Postgres userId from githubUserId when available
  let userId: string | undefined;
  const githubUserId = sessionClaims.githubUserId;
  if (githubUserId) {
    const userStore = makeUserStore(db);
    const found = await userStore.findByGitHubUserId(githubUserId);
    userId = found?.user.id;
  }

  return {
    authKind: sessionClaims.sessionKind === "cli" ? "cli" : "dashboard",
    actorType: "user",
    userId,
    githubUserId,
    actorLabel: sessionClaims.sub,
  };
}

// Authorization helpers — query Postgres membership before accessing tenant data

export interface AuthorizedOrgScope {
  role: MemberRole;
  permissions: string[];
}

export async function requireOrgPermission(
  ctx: RequestContextV2,
  orgId: string,
  permission: string,
  db: DbClient,
): Promise<AuthorizedOrgScope> {
  if (!ctx.userId) {
    throw new OrunError("UNAUTHORIZED", "User identity required for org authorization");
  }

  const orgStore = makeOrgStore(db);
  const membership = await orgStore.getMembership(orgId, ctx.userId);
  if (!membership) {
    throw new OrunError("FORBIDDEN", "Not a member of this organization");
  }

  const permissions = permissionsForRole(membership.role);
  if (!permissions.includes(permission)) {
    throw new OrunError("FORBIDDEN", "Insufficient permissions");
  }

  return { role: membership.role, permissions };
}

export async function requireProjectPermission(
  ctx: RequestContextV2,
  orgId: string,
  _projectId: string,
  permission: string,
  db: DbClient,
): Promise<AuthorizedOrgScope> {
  // Project permissions currently derive from org membership role.
  // Per-project overrides are deferred to a future task.
  return requireOrgPermission(ctx, orgId, permission, db);
}
