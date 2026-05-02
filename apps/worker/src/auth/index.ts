import type { Env, Namespace } from "@orun/types";
import { OrunError } from "./errors";
import { verifyOIDCToken, extractNamespaceFromOIDC, looksLikeOIDC } from "./oidc";
import { verifySessionToken } from "./session";
import { upsertNamespaceSlug } from "./namespace";

export type RequestContext =
  | {
      type: "oidc";
      namespace: Namespace;
      allowedNamespaceIds: string[];
      actor: string;
    }
  | {
      type: "session";
      namespace: null;
      allowedNamespaceIds: string[];
      actor: string;
    }
  | {
      type: "deploy";
      namespace: null;
      allowedNamespaceIds: ["*"];
      actor: "system";
    };

export async function authenticate(
  request: Request,
  env: Env,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<RequestContext> {
  const deployToken = request.headers.get("X-Orun-Deploy-Token");

  if (deployToken) {
    if (!env.ORUN_DEPLOY_TOKEN) {
      throw new OrunError("UNAUTHORIZED", "Deploy token not configured");
    }
    if (deployToken !== env.ORUN_DEPLOY_TOKEN) {
      throw new OrunError("UNAUTHORIZED", "Invalid deploy token");
    }
    return { type: "deploy", namespace: null, allowedNamespaceIds: ["*"], actor: "system" };
  }

  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    throw new OrunError("UNAUTHORIZED", "Missing authorization header");
  }
  const token = auth.slice(7);

  if (looksLikeOIDC(token)) {
    const claims = await verifyOIDCToken(token, env);
    const namespace = extractNamespaceFromOIDC(claims);

    const upsertPromise = upsertNamespaceSlug(env.DB, namespace);
    if (ctx?.waitUntil) {
      ctx.waitUntil(upsertPromise);
    } else {
      await upsertPromise;
    }

    return {
      type: "oidc",
      namespace,
      allowedNamespaceIds: [namespace.namespaceId],
      actor: claims.actor,
    };
  }

  if (!env.ORUN_SESSION_SECRET) {
    throw new OrunError("UNAUTHORIZED", "Session secret not configured");
  }
  const claims = await verifySessionToken(token, env.ORUN_SESSION_SECRET);
  return {
    type: "session",
    namespace: null,
    allowedNamespaceIds: claims.allowedNamespaceIds,
    actor: claims.sub,
  };
}

export { OrunError } from "./errors";
export { verifyOIDCToken, extractNamespaceFromOIDC, looksLikeOIDC } from "./oidc";
export { issueSessionToken, verifySessionToken } from "./session";
export { buildGitHubOAuthRedirect, handleGitHubOAuthCallback, type OAuthCallbackResult } from "./github-oauth";
export { upsertNamespaceSlug } from "./namespace";
