import type { Env } from "@orun/types";
import type { RequestContext } from "../auth";
import { OrunError } from "../auth/errors";
import { json } from "../http";

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  authCtx: RequestContext;
}

interface AccountRow {
  account_id: string;
  github_login: string;
  created_at: string;
}

interface LinkedRepoRow {
  namespace_id: string;
  namespace_slug: string;
  linked_at: string;
}

// ─── D1 Helpers ─────────────────────────────────────────────────────────────

export async function getOrCreateAccount(
  db: D1Database,
  githubLogin: string,
  now?: string,
): Promise<AccountRow> {
  const ts = now ?? new Date().toISOString();
  const accountId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO accounts (account_id, github_login, created_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(github_login) DO NOTHING`,
    )
    .bind(accountId, githubLogin, ts)
    .run();
  const row = await db
    .prepare("SELECT account_id, github_login, created_at FROM accounts WHERE github_login = ?1")
    .bind(githubLogin)
    .first<AccountRow>();
  if (!row) throw new OrunError("INTERNAL_ERROR", "Failed to create account");
  return row;
}

export async function getAccountByLogin(
  db: D1Database,
  githubLogin: string,
): Promise<AccountRow | null> {
  return db
    .prepare("SELECT account_id, github_login, created_at FROM accounts WHERE github_login = ?1")
    .bind(githubLogin)
    .first<AccountRow>();
}

export async function listLinkedRepos(
  db: D1Database,
  accountId: string,
): Promise<LinkedRepoRow[]> {
  const result = await db
    .prepare(
      `SELECT n.namespace_id, n.namespace_slug, ar.linked_at
       FROM account_repos ar
       JOIN namespaces n ON n.namespace_id = ar.namespace_id
       WHERE ar.account_id = ?1
       ORDER BY ar.linked_at DESC`,
    )
    .bind(accountId)
    .all<LinkedRepoRow>();
  return result.results ?? [];
}

export async function linkRepo(
  db: D1Database,
  accountId: string,
  namespaceId: string,
  namespaceSlug: string,
  linkedBy: string,
  now?: string,
): Promise<LinkedRepoRow> {
  const ts = now ?? new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO namespaces (namespace_id, namespace_slug, last_seen_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(namespace_id) DO UPDATE SET
         namespace_slug = excluded.namespace_slug,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(namespaceId, namespaceSlug, ts)
    .run();
  await db
    .prepare(
      `INSERT INTO account_repos (account_id, namespace_id, linked_by, linked_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(account_id, namespace_id) DO NOTHING`,
    )
    .bind(accountId, namespaceId, linkedBy, ts)
    .run();
  const row = await db
    .prepare(
      `SELECT n.namespace_id, n.namespace_slug, ar.linked_at
       FROM account_repos ar
       JOIN namespaces n ON n.namespace_id = ar.namespace_id
       WHERE ar.account_id = ?1 AND ar.namespace_id = ?2`,
    )
    .bind(accountId, namespaceId)
    .first<LinkedRepoRow>();
  if (!row) throw new OrunError("INTERNAL_ERROR", "Failed to link repo");
  return row;
}

export async function unlinkRepo(
  db: D1Database,
  accountId: string,
  namespaceId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM account_repos WHERE account_id = ?1 AND namespace_id = ?2")
    .bind(accountId, namespaceId)
    .run();
}

export async function resolveSessionNamespaceIds(
  authCtx: RequestContext,
  db: D1Database,
): Promise<string[]> {
  const base = [...authCtx.allowedNamespaceIds];
  if (authCtx.type !== "session") return base;
  const account = await getAccountByLogin(db, authCtx.actor);
  if (!account) return base;
  const linked = await db
    .prepare("SELECT namespace_id FROM account_repos WHERE account_id = ?1")
    .bind(account.account_id)
    .all<{ namespace_id: string }>();
  const linkedIds = (linked.results ?? []).map((r) => r.namespace_id);
  const seen = new Set(base);
  for (const id of linkedIds) {
    if (!seen.has(id)) {
      base.push(id);
      seen.add(id);
    }
  }
  return base;
}

// ─── GitHub Admin Verification ──────────────────────────────────────────────

interface VerifiedRepo {
  namespaceId: string;
  namespaceSlug: string;
}

function validateRepoFullName(repoFullName: string): { owner: string; repo: string } {
  if (!repoFullName || typeof repoFullName !== "string") {
    throw new OrunError("INVALID_REQUEST", "repoFullName is required");
  }
  const parts = repoFullName.split("/");
  if (parts.length !== 2) {
    throw new OrunError("INVALID_REQUEST", "repoFullName must be owner/repo");
  }
  const [owner, repo] = parts;
  if (!owner || !repo) {
    throw new OrunError("INVALID_REQUEST", "repoFullName must have non-empty owner and repo");
  }
  if (owner.includes("..") || repo.includes("..")) {
    throw new OrunError("INVALID_REQUEST", "Invalid repoFullName");
  }
  return { owner, repo };
}

export async function verifyRepoAdminAccess(
  githubLogin: string,
  repoFullName: string,
  githubAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedRepo> {
  if (!githubAccessToken) {
    throw new OrunError("UNAUTHORIZED", "GitHub access token is required");
  }

  const { owner, repo } = validateRepoFullName(repoFullName);
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepo = encodeURIComponent(repo);

  const repoResp = await fetchImpl(
    `https://api.github.com/repos/${encodedOwner}/${encodedRepo}`,
    {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "orun-backend-account-linking",
      },
    },
  );

  if (repoResp.status === 404) {
    throw new OrunError("NOT_FOUND", "Repository not found");
  }
  if (!repoResp.ok) {
    throw new OrunError("INTERNAL_ERROR", "GitHub API error");
  }

  const repoData = (await repoResp.json()) as {
    id: number;
    full_name: string;
    owner: { login: string };
    permissions?: { admin?: boolean };
  };

  if (repoData.permissions?.admin === true) {
    return { namespaceId: String(repoData.id), namespaceSlug: repoData.full_name };
  }

  const orgResp = await fetchImpl(
    `https://api.github.com/orgs/${encodeURIComponent(repoData.owner.login)}/memberships/${encodeURIComponent(githubLogin)}`,
    {
      headers: {
        Authorization: `Bearer ${githubAccessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "orun-backend-account-linking",
      },
    },
  );

  if (orgResp.ok) {
    const orgData = (await orgResp.json()) as { role?: string };
    if (orgData.role === "admin") {
      return { namespaceId: String(repoData.id), namespaceSlug: repoData.full_name };
    }
  }

  throw new OrunError("FORBIDDEN", "Admin access required to link repository");
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

export async function handleCreateAccount(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }
  const account = await getOrCreateAccount(rc.env.DB, rc.authCtx.actor);
  return json({
    accountId: account.account_id,
    githubLogin: account.github_login,
    createdAt: account.created_at,
  });
}

export async function handleGetAccount(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }
  const account = await getAccountByLogin(rc.env.DB, rc.authCtx.actor);
  if (!account) {
    throw new OrunError("NOT_FOUND", "Account not found");
  }
  return json({
    accountId: account.account_id,
    githubLogin: account.github_login,
    createdAt: account.created_at,
  });
}

export async function handleLinkRepo(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const githubAccessToken = rc.request.headers.get("X-GitHub-Access-Token");
  if (!githubAccessToken) {
    throw new OrunError("UNAUTHORIZED", "GitHub access token is required");
  }

  let body: Record<string, unknown>;
  try {
    body = (await rc.request.json()) as Record<string, unknown>;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const repoFullName = body.repoFullName as string | undefined;
  if (!repoFullName || typeof repoFullName !== "string") {
    throw new OrunError("INVALID_REQUEST", "repoFullName is required");
  }

  const verified = await verifyRepoAdminAccess(
    rc.authCtx.actor,
    repoFullName,
    githubAccessToken,
  );

  const account = await getOrCreateAccount(rc.env.DB, rc.authCtx.actor);
  const link = await linkRepo(
    rc.env.DB,
    account.account_id,
    verified.namespaceId,
    verified.namespaceSlug,
    rc.authCtx.actor,
  );

  return json({
    namespaceId: link.namespace_id,
    namespaceSlug: link.namespace_slug,
    linkedAt: link.linked_at,
  });
}

export async function handleListLinkedRepos(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }
  const account = await getAccountByLogin(rc.env.DB, rc.authCtx.actor);
  if (!account) {
    return json({ repos: [] });
  }
  const repos = await listLinkedRepos(rc.env.DB, account.account_id);
  return json({
    repos: repos.map((r) => ({
      namespaceId: r.namespace_id,
      namespaceSlug: r.namespace_slug,
      linkedAt: r.linked_at,
    })),
  });
}

export async function handleUnlinkRepo(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }
  const { namespaceId } = rc.params;
  const account = await getAccountByLogin(rc.env.DB, rc.authCtx.actor);
  if (account) {
    await unlinkRepo(rc.env.DB, account.account_id, namespaceId);
  }
  return json({ ok: true });
}
