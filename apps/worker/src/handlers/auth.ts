import type { Env } from "@orun/types";
import type { RequestContext } from "../auth";
import { buildGitHubOAuthRedirect, handleGitHubOAuthCallback, hashRefreshToken } from "../auth";
import { startDeviceFlow, pollDeviceFlow } from "../auth/device-flow";
import { issueSessionToken } from "../auth/session";
import { D1Index } from "@orun/storage";
import { OrunError } from "../auth/errors";
import { getOrCreateAccount, upsertBulkNamespaceSlugs } from "./accounts";
import { json } from "../http";

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  authCtx: RequestContext;
}

const CLI_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export async function handleAuthGitHub(rc: RouteContext): Promise<Response> {
  return buildGitHubOAuthRedirect(rc.request, rc.env);
}

export async function handleAuthGitHubCallback(rc: RouteContext): Promise<Response> {
  const result = await handleGitHubOAuthCallback(rc.request, rc.env);

  if (result.namespaceSlugs && result.namespaceSlugs.length > 0) {
    await upsertBulkNamespaceSlugs(rc.env.DB, result.namespaceSlugs);
  }

  if (result.sessionKind === "cli" && result.refreshToken && result._refreshTokenHash) {
    const account = await getOrCreateAccount(rc.env.DB, result.githubLogin);
    const db = new D1Index(rc.env.DB);
    const expiresAt = result.refreshExpiresAt ?? new Date(Date.now() + CLI_REFRESH_TTL_SECONDS * 1000).toISOString();
    await db.createCliSession({
      sessionId: crypto.randomUUID(),
      accountId: account.account_id,
      githubLogin: result.githubLogin,
      refreshTokenHash: result._refreshTokenHash,
      allowedNamespaceIds: result.allowedNamespaceIds,
      expiresAt,
      userAgent: rc.request.headers.get("User-Agent") ?? undefined,
    });
  }

  if (result.returnTo) {
    const fragmentParams: Record<string, string> = {
      sessionToken: result.sessionToken,
      githubLogin: result.githubLogin,
      allowedNamespaceIds: JSON.stringify(result.allowedNamespaceIds),
    };
    if (result.sessionKind === "cli" && result.refreshToken) {
      fragmentParams.refreshToken = result.refreshToken;
      fragmentParams.refreshExpiresAt = result.refreshExpiresAt ?? "";
    }
    const fragment = new URLSearchParams(fragmentParams).toString();
    return new Response(null, {
      status: 302,
      headers: { Location: `${result.returnTo}#${fragment}` },
    });
  }

  const responseBody: Record<string, unknown> = {
    sessionToken: result.sessionToken,
    sessionKind: result.sessionKind,
    githubLogin: result.githubLogin,
    allowedNamespaceIds: result.allowedNamespaceIds,
  };
  if (result.sessionKind === "cli" && result.refreshToken) {
    responseBody.refreshToken = result.refreshToken;
    responseBody.refreshExpiresAt = result.refreshExpiresAt;
  }
  return json(responseBody);
}

export async function handleCliDeviceStart(rc: RouteContext): Promise<Response> {
  const deviceInfo = await startDeviceFlow(rc.env);
  return json(deviceInfo);
}

export async function handleCliDevicePoll(rc: RouteContext): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await rc.request.json()) as Record<string, unknown>;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const deviceCode = body.deviceCode as string | undefined;
  if (!deviceCode || typeof deviceCode !== "string") {
    throw new OrunError("INVALID_REQUEST", "Missing deviceCode");
  }

  const pollResult = await pollDeviceFlow(deviceCode, rc.env);

  if ("status" in pollResult && pollResult.status === "pending") {
    return json(pollResult, 202);
  }

  const successResult = pollResult as Exclude<typeof pollResult, { status: "pending" }>;

  if (successResult.namespaceSlugs && successResult.namespaceSlugs.length > 0) {
    await upsertBulkNamespaceSlugs(rc.env.DB, successResult.namespaceSlugs);
  }

  const account = await getOrCreateAccount(rc.env.DB, successResult.githubLogin);
  const db = new D1Index(rc.env.DB);
  const expiresAt = successResult.refreshExpiresAt;
  await db.createCliSession({
    sessionId: crypto.randomUUID(),
    accountId: account.account_id,
    githubLogin: successResult.githubLogin,
    refreshTokenHash: successResult._refreshTokenHash,
    allowedNamespaceIds: successResult.allowedNamespaceIds,
    expiresAt,
    userAgent: rc.request.headers.get("User-Agent") ?? undefined,
  });

  return json({
    accessToken: successResult.accessToken,
    expiresAt: successResult.expiresAt,
    refreshToken: successResult.refreshToken,
    refreshExpiresAt: successResult.refreshExpiresAt,
    githubLogin: successResult.githubLogin,
    allowedNamespaceIds: successResult.allowedNamespaceIds,
  });
}

export async function handleCliToken(rc: RouteContext): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await rc.request.json()) as Record<string, unknown>;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const refreshToken = body.refreshToken as string | undefined;
  if (!refreshToken || typeof refreshToken !== "string") {
    throw new OrunError("INVALID_REQUEST", "Missing refreshToken");
  }

  const refreshHash = await hashRefreshToken(refreshToken);
  const db = new D1Index(rc.env.DB);
  const session = await db.getCliSessionByRefreshHash(refreshHash);

  if (!session) {
    throw new OrunError("UNAUTHORIZED", "Invalid refresh token");
  }

  const now = new Date().toISOString();
  if (session.revokedAt) {
    throw new OrunError("UNAUTHORIZED", "Refresh token has been revoked");
  }
  if (session.expiresAt <= now) {
    throw new OrunError("UNAUTHORIZED", "Refresh token expired");
  }

  const sessionSecret = rc.env.ORUN_SESSION_SECRET;
  if (!sessionSecret) {
    throw new OrunError("INTERNAL_ERROR", "Session secret not configured");
  }

  await db.markCliSessionUsed(session.sessionId, now);

  const accessToken = await issueSessionToken(
    {
      sub: session.githubLogin,
      allowedNamespaceIds: session.allowedNamespaceIds,
      sessionKind: "cli",
      tokenUse: "access",
    },
    sessionSecret,
  );
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();

  return json({
    accessToken,
    expiresAt,
    githubLogin: session.githubLogin,
    allowedNamespaceIds: session.allowedNamespaceIds,
  });
}

export async function handleCliLogout(rc: RouteContext): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await rc.request.json()) as Record<string, unknown>;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const refreshToken = body.refreshToken as string | undefined;
  if (!refreshToken || typeof refreshToken !== "string") {
    throw new OrunError("INVALID_REQUEST", "Missing refreshToken");
  }

  const refreshHash = await hashRefreshToken(refreshToken);
  const db = new D1Index(rc.env.DB);
  const session = await db.getCliSessionByRefreshHash(refreshHash);

  if (session && !session.revokedAt) {
    await db.revokeCliSession(session.sessionId, new Date().toISOString());
  }

  return json({ ok: true });
}
