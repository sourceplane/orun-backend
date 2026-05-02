import type { Env } from "@orun/types";
import { handleOptions, errorJson, handleError, json } from "./http";
import { authenticate, type RequestContext } from "./auth";
import { OrunError } from "./auth/errors";
import { handleAuthGitHub, handleAuthGitHubCallback } from "./handlers/auth";
import { handleCreateRun, handleListRuns, handleGetRun } from "./handlers/runs";
import { handleClaimJob, handleUpdateJob, handleHeartbeat, handleRunnable, handleListJobs, handleJobStatus } from "./handlers/jobs";
import { handleUploadLog, handleGetLog } from "./handlers/logs";
import { handleCreateAccount, handleGetAccount, handleLinkRepo, handleListLinkedRepos, handleUnlinkRepo } from "./handlers/accounts";
import { checkRateLimit } from "./rate-limit";

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
  route("POST", "/v1/accounts", handleCreateAccount, "session", true),
  route("GET", "/v1/accounts/me", handleGetAccount, "session", true),
  route("POST", "/v1/accounts/repos", handleLinkRepo, "session", true),
  route("GET", "/v1/accounts/repos", handleListLinkedRepos, "session", true),
  route("DELETE", "/v1/accounts/repos/:namespaceId", handleUnlinkRepo, "session", true),
  route("POST", "/v1/runs", handleCreateRun, "oidc_or_session", true),
  route("GET", "/v1/runs", handleListRuns, "session", true),
  route("GET", "/v1/runs/:runId", handleGetRun, "oidc_or_session", true),
  route("GET", "/v1/runs/:runId/jobs", handleListJobs, "oidc_or_session", true),
  route("GET", "/v1/runs/:runId/jobs/:jobId/status", handleJobStatus, "oidc_or_session", true),
  route("GET", "/v1/runs/:runId/runnable", handleRunnable, "oidc", true),
  route("POST", "/v1/runs/:runId/jobs/:jobId/claim", handleClaimJob, "oidc", true),
  route("POST", "/v1/runs/:runId/jobs/:jobId/update", handleUpdateJob, "oidc", true),
  route("POST", "/v1/runs/:runId/jobs/:jobId/heartbeat", handleHeartbeat, "oidc", true),
  route("POST", "/v1/runs/:runId/logs/:jobId", handleUploadLog, "oidc", true),
  route("GET", "/v1/runs/:runId/logs/:jobId", handleGetLog, "oidc_or_session", true),
];

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
