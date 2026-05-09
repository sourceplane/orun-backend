import type { Env } from "@orun/types";
import { handleOptions, errorJson, handleError, json } from "./http";
import { authenticate, type RequestContext } from "./auth";
import { OrunError } from "./auth/errors";
import { handleAuthGitHub, handleAuthGitHubCallback, handleCliDeviceStart, handleCliDevicePoll, handleCliToken, handleCliLogout } from "./handlers/auth";
import { handleCreateRun, handleListRuns, handleGetRun } from "./handlers/runs";
import { handleClaimJob, handleUpdateJob, handleHeartbeat, handleRunnable, handleListJobs, handleJobStatus } from "./handlers/jobs";
import { handleUploadLog, handleGetLog } from "./handlers/logs";
import { handleCreateAccount, handleGetAccount, handleLinkRepo, handleListLinkedRepos, handleUnlinkRepo, handleLinkRepoFromSession } from "./handlers/accounts";
import { handleCatalogSync, handleListCatalogComponents, handleGetCatalogComponent, handleGetCatalogComponentHistory, handleGetCatalogComponentRuns, handleGetCatalogComponentDependencies, handleListRepoComponents } from "./handlers/catalog";
import { checkRateLimit } from "./rate-limit";
import { makeWorkerDbClient } from "./db";
import { authenticateV2, type RequestContextV2 } from "./auth/v2";
import { handleV2Me } from "./handlers/v2/me";
import { handleCreateOrg, handleListOrgs, handleGetOrg } from "./handlers/v2/organizations";
import { handleCreateProject, handleListProjects, handleGetProject } from "./handlers/v2/projects";

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  authCtx: RequestContext;
}

type Handler = (rc: RouteContext) => Promise<Response>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
  auth: "none" | "oidc" | "session" | "oidc_or_session";
  rateLimit: boolean;
}

function route(method: string, path: string, handler: Handler, auth: Route["auth"], rateLimit = true): Route {
  const paramNames: string[] = [];
  const regexStr = path.replace(/:([a-zA-Z]+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { method, pattern: new RegExp(`^${regexStr}$`), paramNames, handler, auth, rateLimit };
}

const routes: Route[] = [
  route("GET", "/v1/auth/github", handleAuthGitHub, "none", false),
  route("GET", "/v1/auth/github/callback", handleAuthGitHubCallback, "none", false),
  route("POST", "/v1/auth/cli/device/start", handleCliDeviceStart, "none", false),
  route("POST", "/v1/auth/cli/device/poll", handleCliDevicePoll, "none", false),
  route("POST", "/v1/auth/cli/token", handleCliToken, "none", false),
  route("POST", "/v1/auth/cli/logout", handleCliLogout, "none", false),
  route("POST", "/v1/accounts", handleCreateAccount, "session", true),
  route("GET", "/v1/accounts/me", handleGetAccount, "session", true),
  route("POST", "/v1/accounts/repos/link", handleLinkRepoFromSession, "session", true),
  route("POST", "/v1/accounts/repos", handleLinkRepo, "session", true),
  route("GET", "/v1/accounts/repos", handleListLinkedRepos, "session", true),
  route("DELETE", "/v1/accounts/repos/:namespaceId", handleUnlinkRepo, "session", true),
  route("POST", "/v1/runs", handleCreateRun, "oidc_or_session", true),
  route("GET", "/v1/runs", handleListRuns, "session", true),
  route("GET", "/v1/runs/:runId", handleGetRun, "oidc_or_session", true),
  route("GET", "/v1/runs/:runId/jobs", handleListJobs, "oidc_or_session", true),
  route("GET", "/v1/runs/:runId/jobs/:jobId/status", handleJobStatus, "oidc_or_session", true),
  route("GET", "/v1/runs/:runId/runnable", handleRunnable, "oidc_or_session", true),
  route("POST", "/v1/runs/:runId/jobs/:jobId/claim", handleClaimJob, "oidc_or_session", true),
  route("POST", "/v1/runs/:runId/jobs/:jobId/update", handleUpdateJob, "oidc_or_session", true),
  route("POST", "/v1/runs/:runId/jobs/:jobId/heartbeat", handleHeartbeat, "oidc_or_session", true),
  route("POST", "/v1/runs/:runId/logs/:jobId", handleUploadLog, "oidc_or_session", true),
  route("GET", "/v1/runs/:runId/logs/:jobId", handleGetLog, "oidc_or_session", true),
  route("POST", "/v1/catalog/sync", handleCatalogSync, "oidc", true),
  route("GET", "/v1/catalog/components", handleListCatalogComponents, "session", true),
  route("GET", "/v1/catalog/components/:componentId", handleGetCatalogComponent, "session", true),
  route("GET", "/v1/catalog/components/:componentId/history", handleGetCatalogComponentHistory, "session", true),
  route("GET", "/v1/catalog/components/:componentId/runs", handleGetCatalogComponentRuns, "session", true),
  route("GET", "/v1/catalog/components/:componentId/dependencies", handleGetCatalogComponentDependencies, "session", true),
  route("GET", "/v1/repos/:repoId/components", handleListRepoComponents, "session", true),
];

// ─── V2 Routes ────────────────────────────────────────────────────────────────

type V2Db = ReturnType<typeof makeWorkerDbClient>;
type V2Handler = (
  request: Request,
  authCtx: RequestContextV2,
  db: V2Db,
  params: Record<string, string>,
) => Promise<Response>;

interface V2Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: V2Handler;
}

function v2route(method: string, path: string, handler: V2Handler): V2Route {
  const paramNames: string[] = [];
  const regexStr = path.replace(/:([a-zA-Z]+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { method, pattern: new RegExp(`^${regexStr}$`), paramNames, handler };
}

const v2routes: V2Route[] = [
  v2route("GET",  "/v2/me",                                       (req, ctx, db) => handleV2Me(req, ctx, db)),
  v2route("POST", "/v2/organizations",                            (req, ctx, db) => handleCreateOrg(req, ctx, db)),
  v2route("GET",  "/v2/organizations",                            (req, ctx, db) => handleListOrgs(req, ctx, db)),
  v2route("GET",  "/v2/organizations/:orgId",                     (req, ctx, db, p) => handleGetOrg(req, ctx, db, p.orgId)),
  v2route("POST", "/v2/organizations/:orgId/projects",            (req, ctx, db, p) => handleCreateProject(req, ctx, db, p.orgId)),
  v2route("GET",  "/v2/organizations/:orgId/projects",            (req, ctx, db, p) => handleListProjects(req, ctx, db, p.orgId)),
  v2route("GET",  "/v2/organizations/:orgId/projects/:projectId", (req, ctx, db, p) => handleGetProject(req, ctx, db, p.orgId, p.projectId)),
];

function isV2Path(path: string): boolean {
  return v2routes.some((r) => r.pattern.test(path));
}

async function routeV2(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  path: string,
  method: string,
): Promise<Response | null> {
  for (const r of v2routes) {
    if (r.method !== method) continue;
    const match = r.pattern.exec(path);
    if (!match) continue;

    const params: Record<string, string> = {};
    for (let i = 0; i < r.paramNames.length; i++) {
      params[r.paramNames[i]] = decodeURIComponent(match[i + 1]);
    }

    if (!env.HYPERDRIVE) {
      return errorJson("INTERNAL_ERROR", "V2 database not configured", 503);
    }

    const db = makeWorkerDbClient(env.HYPERDRIVE.connectionString);
    const authCtx = await authenticateV2(request, env, db);

    return r.handler(request, authCtx, db, params);
  }
  return null;
}

export async function routeRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    return await routeRequestInner(request, env, ctx);
  } catch (err: unknown) {
    return handleError(err);
  }
}

async function routeRequestInner(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === "OPTIONS") {
    return handleOptions();
  }

  if (path === "/" && method === "GET") {
    return json({ status: "ok", service: "orun-api" });
  }

  // V2 routes — auth + Postgres via Hyperdrive
  if (path.startsWith("/v2/")) {
    const v2resp = await routeV2(request, env, ctx, path, method);
    if (v2resp) return v2resp;
    return isV2Path(path)
      ? errorJson("INVALID_REQUEST", "Method not allowed", 405)
      : errorJson("NOT_FOUND", "Not found", 404);
  }

  // V1 routes
  for (const r of routes) {
    if (r.method !== method) continue;
    const match = r.pattern.exec(path);
    if (!match) continue;

    const params: Record<string, string> = {};
    for (let i = 0; i < r.paramNames.length; i++) {
      params[r.paramNames[i]] = decodeURIComponent(match[i + 1]);
    }

    let authCtx: RequestContext;
    if (r.auth === "none") {
      authCtx = { type: "deploy", namespace: null, allowedNamespaceIds: ["*"], actor: "system" };
    } else {
      authCtx = await authenticate(request, env, ctx);

      if (r.auth === "oidc" && authCtx.type !== "oidc") {
        throw new OrunError("FORBIDDEN", "OIDC authentication required");
      }
      if (r.auth === "session" && authCtx.type !== "session") {
        throw new OrunError("FORBIDDEN", "Session authentication required");
      }
      if (r.auth === "oidc_or_session" && authCtx.type === "deploy") {
        throw new OrunError("FORBIDDEN", "Deploy token not accepted for this endpoint");
      }
    }

    if (r.rateLimit && authCtx.type !== "deploy") {
      const namespaceId = authCtx.type === "oidc"
        ? authCtx.namespace.namespaceId
        : authCtx.allowedNamespaceIds[0] ?? authCtx.actor;
      const limitResp = await checkRateLimit(env, namespaceId);
      if (limitResp) return limitResp;
    }

    return r.handler({ request, env, ctx, params, authCtx });
  }

  const knownPath = routes.some((r) => r.pattern.test(path));
  if (knownPath) {
    return errorJson("INVALID_REQUEST", "Method not allowed", 405);
  }

  return errorJson("NOT_FOUND", "Not found", 404);
}
