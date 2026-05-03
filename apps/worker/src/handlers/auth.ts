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

  if (result.returnTo) {
    const fragment = new URLSearchParams({
      sessionToken: result.sessionToken,
      githubLogin: result.githubLogin,
      allowedNamespaceIds: JSON.stringify(result.allowedNamespaceIds),
    }).toString();

    return new Response(null, {
      status: 302,
      headers: { Location: `${result.returnTo}#${fragment}` },
    });
  }

  return json({
    sessionToken: result.sessionToken,
    githubLogin: result.githubLogin,
    allowedNamespaceIds: result.allowedNamespaceIds,
  });
}
