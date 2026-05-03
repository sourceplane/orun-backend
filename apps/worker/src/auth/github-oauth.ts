import type { Env } from "@orun/types";
import { OrunError } from "./errors";
import { signHmac, verifyHmac } from "./jwt";
import { base64urlEncode, base64urlDecode, base64urlEncodeString, base64urlDecodeString } from "./base64url";
import { issueSessionToken } from "./session";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_BASE = "https://api.github.com";
const OAUTH_STATE_TTL_SECONDS = 600;
const USER_AGENT = "orun-backend-auth";

export interface GitHubOAuthUser {
  login: string;
  id: number;
}

export interface GitHubRepoPermission {
  id: number;
  full_name: string;
  permissions?: { admin?: boolean };
}

interface StatePayload {
  nonce: string;
  exp: number;
  returnTo?: string;
}

async function buildSignedState(secret: string, returnTo?: string): Promise<string> {
  const nonce = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
  const exp = Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS;
  const payload: StatePayload = { nonce, exp };
  if (returnTo) {
    payload.returnTo = returnTo;
  }
  const data = base64urlEncodeString(JSON.stringify(payload));
  const sig = await signHmac(data, secret);
  return `${data}.${base64urlEncode(sig)}`;
}

async function verifySignedState(state: string, secret: string): Promise<StatePayload> {
  const dotIdx = state.lastIndexOf(".");
  if (dotIdx === -1) {
    throw new OrunError("INVALID_REQUEST", "Invalid OAuth state");
  }
  const data = state.slice(0, dotIdx);
  const sigB64 = state.slice(dotIdx + 1);
  const sigBytes = base64urlDecode(sigB64);
  const valid = await verifyHmac(data, sigBytes, secret);
  if (!valid) {
    throw new OrunError("INVALID_REQUEST", "Invalid OAuth state signature");
  }
  let payload: StatePayload;
  try {
    payload = JSON.parse(base64urlDecodeString(data)) as StatePayload;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid OAuth state");
  }
  if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new OrunError("INVALID_REQUEST", "OAuth state expired");
  }
  return payload;
}

function requireSecret(env: Env, name: string): string {
  const val = (env as unknown as Record<string, unknown>)[name] as string | undefined;
  if (!val) {
    throw new OrunError("INTERNAL_ERROR", `${name} not configured`);
  }
  return val;
}

function buildCallbackUrl(request: Request, env: Env): string {
  if (env.ORUN_PUBLIC_URL) {
    return `${env.ORUN_PUBLIC_URL}/v1/auth/github/callback`;
  }
  const url = new URL(request.url);
  return `${url.origin}/v1/auth/github/callback`;
}

function validateReturnTo(returnTo: string, env: Env, request: Request): string {
  let parsed: URL;
  try {
    parsed = new URL(returnTo);
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid returnTo URL");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new OrunError("INVALID_REQUEST", "Invalid returnTo URL");
  }
  if (env.ORUN_DASHBOARD_URL) {
    const dashboardOrigin = new URL(env.ORUN_DASHBOARD_URL).origin;
    if (parsed.origin !== dashboardOrigin) {
      throw new OrunError("INVALID_REQUEST", "returnTo origin not allowed");
    }
  } else {
    const requestOrigin = new URL(request.url).origin;
    if (parsed.origin !== requestOrigin) {
      throw new OrunError("INVALID_REQUEST", "returnTo origin not allowed");
    }
  }
  return returnTo;
}

export async function buildGitHubOAuthRedirect(
  request: Request,
  env: Env,
): Promise<Response> {
  const clientId = requireSecret(env, "GITHUB_CLIENT_ID");
  const sessionSecret = requireSecret(env, "ORUN_SESSION_SECRET");

  const url = new URL(request.url);
  const returnToParam = url.searchParams.get("returnTo");
  let returnTo: string | undefined;
  if (returnToParam) {
    returnTo = validateReturnTo(returnToParam, env, request);
  }

  const state = await buildSignedState(sessionSecret, returnTo);
  const redirectUri = buildCallbackUrl(request, env);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user,read:org",
    state,
  });

  return Response.redirect(`${GITHUB_AUTHORIZE_URL}?${params.toString()}`, 302);
}

async function exchangeCodeForToken(
  code: string,
  env: Env,
  redirectUri: string,
): Promise<string> {
  const clientId = requireSecret(env, "GITHUB_CLIENT_ID");
  const clientSecret = requireSecret(env, "GITHUB_CLIENT_SECRET");

  const resp = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!resp.ok) {
    throw new OrunError("UNAUTHORIZED", "Failed to exchange OAuth code");
  }

  const data: Record<string, unknown> = await resp.json();
  if (!data.access_token || typeof data.access_token !== "string") {
    throw new OrunError("UNAUTHORIZED", "GitHub OAuth token exchange failed");
  }

  return data.access_token;
}

async function fetchGitHubUser(accessToken: string): Promise<GitHubOAuthUser> {
  const resp = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
  });

  if (!resp.ok) {
    throw new OrunError("UNAUTHORIZED", "Failed to fetch GitHub user");
  }

  const data: Record<string, unknown> = await resp.json();
  return { login: data.login as string, id: data.id as number };
}

async function fetchAllPages<T>(
  url: string,
  accessToken: string,
): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const resp = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
      },
    });

    if (!resp.ok) break;

    const page: T[] = await resp.json();
    results.push(...page);

    const link = resp.headers.get("Link");
    nextUrl = parseLinkNext(link);
  }

  return results;
}

function parseLinkNext(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

async function fetchAdminRepos(accessToken: string): Promise<string[]> {
  const repos = await fetchAllPages<GitHubRepoPermission>(
    `${GITHUB_API_BASE}/user/repos?type=all&per_page=100`,
    accessToken,
  );
  return repos
    .filter((r) => r.permissions?.admin)
    .map((r) => String(r.id));
}

interface OrgMembership {
  organization: { login: string };
  role: string;
}

async function fetchOrgAdminRepoIds(accessToken: string): Promise<string[]> {
  const memberships = await fetchAllPages<OrgMembership>(
    `${GITHUB_API_BASE}/user/memberships/orgs?per_page=100`,
    accessToken,
  );

  const adminOrgs = memberships.filter((m) => m.role === "admin");
  const ids: string[] = [];

  for (const org of adminOrgs) {
    const repos = await fetchAllPages<GitHubRepoPermission>(
      `${GITHUB_API_BASE}/orgs/${org.organization.login}/repos?type=all&per_page=100`,
      accessToken,
    );
    for (const r of repos) {
      ids.push(String(r.id));
    }
  }

  return ids;
}

export interface OAuthCallbackResult {
  sessionToken: string;
  githubLogin: string;
  allowedNamespaceIds: string[];
  returnTo?: string;
}

export async function handleGitHubOAuthCallback(
  request: Request,
  env: Env,
): Promise<OAuthCallbackResult> {
  const sessionSecret = requireSecret(env, "ORUN_SESSION_SECRET");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    throw new OrunError("INVALID_REQUEST", "Missing OAuth code");
  }
  if (!state) {
    throw new OrunError("INVALID_REQUEST", "Missing OAuth state");
  }

  const statePayload = await verifySignedState(state, sessionSecret);

  const redirectUri = buildCallbackUrl(request, env);
  const accessToken = await exchangeCodeForToken(code, env, redirectUri);
  const user = await fetchGitHubUser(accessToken);

  const [repoIds, orgRepoIds] = await Promise.all([
    fetchAdminRepos(accessToken),
    fetchOrgAdminRepoIds(accessToken),
  ]);

  const allowedNamespaceIds = [...new Set([...repoIds, ...orgRepoIds])];

  const sessionToken = await issueSessionToken(
    { sub: user.login, allowedNamespaceIds },
    sessionSecret,
  );

  return { sessionToken, githubLogin: user.login, allowedNamespaceIds, returnTo: statePayload.returnTo };
}
