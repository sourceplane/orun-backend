import type { Env } from "@orun/types";
import type { RequestContext } from "../auth";
import { buildGitHubOAuthRedirect, handleGitHubOAuthCallback } from "../auth";
import { json } from "../http";

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  authCtx: RequestContext;
}

export async function handleAuthGitHub(rc: RouteContext): Promise<Response> {
  return buildGitHubOAuthRedirect(rc.request, rc.env);
}

export async function handleAuthGitHubCallback(rc: RouteContext): Promise<Response> {
  const result = await handleGitHubOAuthCallback(rc.request, rc.env);
  return json(result);
}
