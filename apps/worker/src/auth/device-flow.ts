import type { Env } from "@orun/types";
import { OrunError } from "./errors";
import { generateRefreshToken } from "./github-oauth";
import type { NamespaceRef } from "./github-oauth";
import { issueSessionToken } from "./session";
import { base64urlEncode, base64urlEncodeString, base64urlDecodeString } from "./base64url";
import { signHmac, verifyHmac } from "./jwt";

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_API_BASE = "https://api.github.com";
const DEVICE_SCOPE = "read:user,read:org";
const USER_AGENT = "orun-backend-auth";

const DEVICE_STATE_TTL_SECONDS = 600;

export interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface DevicePollPendingResponse {
  status: "pending";
  interval: number;
}

export interface DevicePollSuccessResponse {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  refreshExpiresAt: string;
  githubLogin: string;
  githubUserId: string;
  allowedNamespaceIds: string[];
  namespaceSlugs: NamespaceRef[];
  _refreshTokenHash: string;
}

function requireSecret(env: Env, name: string): string {
  const val = (env as unknown as Record<string, unknown>)[name] as string | undefined;
  if (!val) {
    throw new OrunError("INTERNAL_ERROR", `${name} not configured`);
  }
  return val;
}

export async function startDeviceFlow(env: Env): Promise<DeviceStartResponse> {
  const clientId = requireSecret(env, "GITHUB_CLIENT_ID");

  const resp = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ client_id: clientId, scope: DEVICE_SCOPE }),
  });

  if (!resp.ok) {
    throw new OrunError("INTERNAL_ERROR", "Failed to start device flow");
  }

  const data = (await resp.json()) as Record<string, unknown>;

  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new OrunError("INTERNAL_ERROR", "Invalid device flow response from GitHub");
  }

  return {
    deviceCode: data.device_code as string,
    userCode: data.user_code as string,
    verificationUri: data.verification_uri as string,
    verificationUriComplete: (data.verification_uri_complete as string) ?? (data.verification_uri as string),
    expiresIn: (data.expires_in as number) ?? 900,
    interval: (data.interval as number) ?? 5,
  };
}

interface GitHubRepoPermission {
  id: number;
  full_name: string;
  permissions?: { admin?: boolean };
}

interface OrgMembership {
  organization: { login: string };
  role: string;
}

async function fetchAllPages<T>(url: string, accessToken: string): Promise<T[]> {
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

async function fetchAdminRepos(accessToken: string): Promise<NamespaceRef[]> {
  const repos = await fetchAllPages<GitHubRepoPermission>(
    `${GITHUB_API_BASE}/user/repos?type=all&per_page=100`,
    accessToken,
  );
  return repos.filter((r) => r.permissions?.admin).map((r) => ({ id: String(r.id), slug: r.full_name }));
}

async function fetchOrgAdminRepos(accessToken: string): Promise<NamespaceRef[]> {
  const memberships = await fetchAllPages<OrgMembership>(
    `${GITHUB_API_BASE}/user/memberships/orgs?per_page=100`,
    accessToken,
  );
  const adminOrgs = memberships.filter((m) => m.role === "admin");
  const items: NamespaceRef[] = [];
  for (const org of adminOrgs) {
    const repos = await fetchAllPages<GitHubRepoPermission>(
      `${GITHUB_API_BASE}/orgs/${org.organization.login}/repos?type=all&per_page=100`,
      accessToken,
    );
    for (const r of repos) items.push({ id: String(r.id), slug: r.full_name });
  }
  return items;
}

export async function pollDeviceFlow(
  deviceCode: string,
  env: Env,
): Promise<DevicePollPendingResponse | DevicePollSuccessResponse> {
  const clientId = requireSecret(env, "GITHUB_CLIENT_ID");
  const sessionSecret = requireSecret(env, "ORUN_SESSION_SECRET");

  const resp = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });

  if (!resp.ok) {
    throw new OrunError("INTERNAL_ERROR", "Failed to poll device flow");
  }

  const data = (await resp.json()) as Record<string, unknown>;

  if (data.error) {
    const errorCode = data.error as string;
    if (errorCode === "authorization_pending") {
      return { status: "pending", interval: 5 };
    }
    if (errorCode === "slow_down") {
      const interval = typeof data.interval === "number" ? data.interval : 10;
      throw new OrunError("RATE_LIMITED", `slow_down: retry after ${interval}s`);
    }
    if (errorCode === "expired_token") {
      throw new OrunError("UNAUTHORIZED", "Device code expired");
    }
    if (errorCode === "access_denied") {
      throw new OrunError("FORBIDDEN", "Device authorization denied");
    }
    throw new OrunError("INVALID_REQUEST", `GitHub device flow error: ${errorCode}`);
  }

  if (!data.access_token || typeof data.access_token !== "string") {
    throw new OrunError("INTERNAL_ERROR", "Missing access token in device flow response");
  }

  const githubAccessToken = data.access_token as string;

  const userResp = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      Authorization: `Bearer ${githubAccessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": USER_AGENT,
    },
  });
  if (!userResp.ok) {
    throw new OrunError("UNAUTHORIZED", "Failed to fetch GitHub user after device flow");
  }
  const user = (await userResp.json()) as { login: string; id: number };

  const [repoItems, orgRepoItems] = await Promise.all([
    fetchAdminRepos(githubAccessToken),
    fetchOrgAdminRepos(githubAccessToken),
  ]);
  const seen = new Map<string, string>();
  for (const r of [...repoItems, ...orgRepoItems]) {
    if (!seen.has(r.id)) seen.set(r.id, r.slug);
  }
  const namespaceSlugs: NamespaceRef[] = Array.from(seen.entries()).map(([id, slug]) => ({ id, slug }));
  const allowedNamespaceIds = namespaceSlugs.map((r) => r.id);

  const accessToken = await issueSessionToken(
    { sub: user.login, allowedNamespaceIds, sessionKind: "cli", tokenUse: "access", githubUserId: String(user.id) },
    sessionSecret,
  );
  const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
  const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { raw: refreshToken, hash: _refreshTokenHash } = await generateRefreshToken();

  return {
    accessToken,
    expiresAt,
    refreshToken,
    refreshExpiresAt,
    githubLogin: user.login,
    githubUserId: String(user.id),
    allowedNamespaceIds,
    namespaceSlugs,
    _refreshTokenHash,
  };
}
