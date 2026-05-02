# Spec 08 — Account & Repo Linking

## Scope

This spec defines the account model, repo linking flow, and permission verification logic. Accounts are optional — the system works fully without them via OIDC. Accounts unlock UI dashboard access and higher rate limits.

**Agent task**: Implement `packages/worker/src/handlers/accounts.ts` and related D1 queries.

---

## Core Principle

> Accounts observe data. They do not own it.

Runs are always written under `namespace_id = repository_id`. An account is a UI overlay that allows a human to see runs from repos they administrate.

---

## Account Creation

```
POST /v1/accounts
Authorization: Bearer <session JWT>

Request body: {} (no fields required at creation time)

Response:
{
  "accountId": "uuid",
  "githubLogin": "rahul",
  "createdAt": "ISO8601"
}
```

**Logic**:
1. Verify session JWT
2. Upsert into D1 `accounts` table:
   ```sql
   INSERT INTO accounts (account_id, github_login, created_at)
   VALUES (?, ?, ?)
   ON CONFLICT(github_login) DO NOTHING
   RETURNING *
   ```
3. Return existing or newly created account

One GitHub login maps to one account. Repeated calls are idempotent.

---

## Repo Linking

### Request

```
POST /v1/accounts/repos
Authorization: Bearer <session JWT>

{
  "repoFullName": "sourceplane/orun"   // e.g. "org/repo"
}
```

### Permission Verification (Critical)

Before storing the link, verify the requesting user is an **admin** of the repository:

```typescript
async function verifyRepoAdminAccess(githubLogin: string, repoFullName: string, accessToken: string): Promise<void> {
  const resp = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (resp.status === 404) throw new OrunError("NOT_FOUND", "Repository not found or no access");
  if (!resp.ok) throw new OrunError("INTERNAL_ERROR", "GitHub API error");

  const data = await resp.json();

  if (!data.permissions?.admin) {
    // Fallback: check org admin
    const isOrgAdmin = await checkOrgAdmin(githubLogin, data.owner.login, accessToken);
    if (!isOrgAdmin) {
      throw new OrunError("FORBIDDEN", "You must be a repository admin or org admin to link this repo");
    }
  }
}

async function checkOrgAdmin(login: string, org: string, accessToken: string): Promise<boolean> {
  const resp = await fetch(`https://api.github.com/orgs/${org}/memberships/${login}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) return false;
  const data = await resp.json();
  return data.role === "admin";
}
```

### Response

```json
{
  "namespaceId": "123456789",
  "namespaceSlug": "sourceplane/orun",
  "linkedAt": "ISO8601"
}
```

### Link Storage

```sql
INSERT INTO account_repos (account_id, namespace_id, linked_by, linked_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(account_id, namespace_id) DO NOTHING
```

Where `namespace_id` = the GitHub `repository.id` (numeric, as a string) fetched from the GitHub API response.

---

## List Linked Repos

```
GET /v1/accounts/repos
Authorization: Bearer <session JWT>
```

```sql
SELECT n.namespace_id, n.namespace_slug, ar.linked_at
FROM account_repos ar
JOIN namespaces n ON n.namespace_id = ar.namespace_id
WHERE ar.account_id = ?
ORDER BY ar.linked_at DESC
```

Response:
```json
{
  "repos": [
    { "namespaceId": "123456789", "namespaceSlug": "sourceplane/orun", "linkedAt": "..." }
  ]
}
```

---

## Unlink Repo

```
DELETE /v1/accounts/repos/:namespaceId
Authorization: Bearer <session JWT>
```

```sql
DELETE FROM account_repos WHERE account_id = ? AND namespace_id = ?
```

Unlinking does not delete any run data. It only removes the visibility grant.

---

## Session Token and Linked Repos

When a user logs in via GitHub OAuth, their `allowedNamespaceIds` in the session JWT is computed from:
1. Repos where `permissions.admin === true` from `/user/repos`
2. Repos in orgs where the user is an org admin

**Additionally**, when the session JWT is presented to the `GET /v1/runs` endpoint, the Worker queries D1 to also include repos linked via `account_repos`:

```typescript
async function resolveNamespaceIds(sessionClaims: SessionClaims, db: D1Database): Promise<string[]> {
  // Start with what's in the JWT (real-time from GitHub at login)
  const fromJWT = sessionClaims.allowedNamespaceIds;

  // Also include account-linked repos
  const account = await db.prepare(
    "SELECT account_id FROM accounts WHERE github_login = ?"
  ).bind(sessionClaims.sub).first();

  if (!account) return fromJWT;

  const linked = await db.prepare(
    "SELECT namespace_id FROM account_repos WHERE account_id = ?"
  ).bind(account.account_id).all();

  const fromAccount = linked.results.map((r: any) => r.namespace_id as string);

  // Union: user sees repos they have direct access to OR have linked
  return [...new Set([...fromJWT, ...fromAccount])];
}
```

---

## Handling Repo Renames and Transfers

When a repo is renamed or transferred to another org:
- The `repository_id` in OIDC tokens does **not** change
- The `repository` slug in OIDC tokens will show the **new** slug

The `upsertNamespaceSlug` call (in auth middleware) updates D1 lazily on each OIDC-authenticated request:

```sql
INSERT INTO namespaces (namespace_id, namespace_slug, last_seen_at)
VALUES (?, ?, ?)
ON CONFLICT(namespace_id) DO UPDATE SET
  namespace_slug = excluded.namespace_slug,
  last_seen_at = excluded.last_seen_at
```

For repo transfers between orgs:
- Old org members may still have cached session tokens with the old namespace ID in `allowedNamespaceIds`
- GitHub OAuth re-login will recompute access from the current GitHub permissions
- The Worker does **not** proactively invalidate sessions on transfer — rely on 1-hour session TTL

---

## Rate Limit Tier Upgrade

When a namespace_id is linked to an account, the Worker can look up the account's tier in D1 to apply higher rate limits:

```typescript
async function getRateLimitTier(namespaceId: string, db: D1Database): Promise<"free" | "premium"> {
  const result = await db.prepare(`
    SELECT a.tier FROM accounts a
    JOIN account_repos ar ON ar.account_id = a.account_id
    WHERE ar.namespace_id = ?
    LIMIT 1
  `).bind(namespaceId).first();

  return (result as any)?.tier === "premium" ? "premium" : "free";
}
```

The `accounts` table will need a `tier TEXT NOT NULL DEFAULT 'free'` column (add in a future migration when billing is implemented).

---

## Testing Requirements

- Unit test `verifyRepoAdminAccess` with mocked GitHub API responses
- Test: non-admin user trying to link → 403
- Test: repo not found → 404
- Test: org admin user (not repo admin) can link
- Test: idempotent account creation
- Test: `resolveNamespaceIds` merges JWT namespaces + D1 linked repos
- Test: repo rename updates slug in D1 on next OIDC request
