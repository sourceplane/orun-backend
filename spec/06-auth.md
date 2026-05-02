# Spec 06 — Authentication (`packages/worker/src/auth`)

## Scope

Authentication is implemented as middleware within the Worker. This spec defines the exact verification logic for both auth modes, session token issuance, and the GitHub OAuth flow for UI access.

**Agent task**: Implement `packages/worker/src/auth/` as a set of pure functions that the Worker's router calls.

---

## Auth Modes

| Mode | Used by | Token type | Identity source |
|------|---------|-----------|-----------------|
| OIDC | GitHub Actions CI runners | `Authorization: Bearer <GitHub OIDC JWT>` | GitHub JWKS |
| Session | UI, CLI login | `Authorization: Bearer <orun session JWT>` | HMAC-signed by Worker secret |
| Deploy token | Bootstrap only (not runtime) | `X-Orun-Deploy-Token: <token>` | Worker secret env var |

---

## GitHub OIDC Verification

### JWKS Fetching

```typescript
async function fetchJWKS(jwksUrl: string): Promise<JsonWebKeySet> {
  // Cache for 15 minutes (use in-memory cache or KV)
  // Fetch from: https://token.actions.githubusercontent.com/.well-known/jwks
  // Return parsed JWKS
}
```

### JWT Verification

```typescript
async function verifyOIDCToken(token: string, env: Env): Promise<OIDCClaims> {
  const jwks = await fetchJWKS(env.GITHUB_JWKS_URL);

  // 1. Decode JWT header to get kid
  // 2. Find matching JWK in JWKS
  // 3. Verify signature using Web Crypto API (importKey + verify)
  // 4. Verify: exp > now, iat < now + 60s clock skew
  // 5. Verify: iss === "https://token.actions.githubusercontent.com"
  // 6. Verify: aud === env.GITHUB_OIDC_AUDIENCE (e.g. "orun")
  // 7. Return typed OIDCClaims

  // On any failure: throw new OrunError("UNAUTHORIZED", "Invalid OIDC token")
}
```

Required claims that must be present and non-empty:
- `repository` (e.g. `"sourceplane/orun"`)
- `repository_id` (GitHub numeric ID as string)
- `repository_owner`
- `repository_owner_id`
- `actor`

### Namespace Extraction from OIDC

```typescript
function extractNamespaceFromOIDC(claims: OIDCClaims): Namespace {
  return {
    namespaceId: claims.repository_id,         // canonical, immutable
    namespaceSlug: claims.repository,           // display only
  };
}
```

---

## GitHub OAuth Flow (UI Login)

### Step 1: Redirect to GitHub

```
GET /v1/auth/github

→ Redirect to: https://github.com/login/oauth/authorize
     ?client_id=<GITHUB_CLIENT_ID>
     &redirect_uri=<WORKER_URL>/v1/auth/github/callback
     &scope=read:user,read:org
     &state=<random CSRF token, stored in KV for 10 min>
```

### Step 2: GitHub Callback

```
GET /v1/auth/github/callback?code=<code>&state=<state>

1. Verify state matches KV value (prevent CSRF)
2. Exchange code for access_token:
   POST https://github.com/login/oauth/access_token
     { client_id, client_secret, code, redirect_uri }
3. Fetch user identity:
   GET https://api.github.com/user
   Authorization: Bearer <access_token>
   → { login, id, ... }
4. Fetch repos with admin access (for namespace discovery):
   GET https://api.github.com/user/repos?type=all&per_page=100
   → filter: permissions.admin === true
5. Extract allowed namespaces:
   allowedNamespaceIds = repos.filter(r => r.permissions.admin).map(r => String(r.id))
6. Issue orun session JWT (see below)
7. Return session token to client
```

### Session JWT Structure

Issued and verified by the Worker. Signed with `ORUN_SESSION_SECRET` (Workers secret, HMAC-SHA256).

```typescript
const sessionPayload: SessionClaims = {
  sub: githubLogin,
  allowedNamespaceIds,   // list of numeric repository IDs user can access
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,  // 1 hour
};
```

**Important**: `allowedNamespaceIds` is derived from repos where `permissions.admin === true` at login time. It is baked into the token and valid for its lifetime. Clients must re-login to refresh permissions.

### Org Admin Check (Elevated Access)

If a user has GitHub org admin role, they may access all repos in that org:

```typescript
// GET https://api.github.com/user/memberships/orgs
// → filter where role === "admin"
// → for each admin org, fetch all repos in that org
// → add those repo IDs to allowedNamespaceIds
```

---

## Session Token Verification

```typescript
async function verifySessionToken(token: string, secret: string): Promise<SessionClaims> {
  // 1. Split JWT into header.payload.signature
  // 2. Verify HMAC-SHA256 signature using Web Crypto API
  // 3. Check exp > now
  // 4. Return parsed SessionClaims
  // On failure: throw OrunError("UNAUTHORIZED")
}
```

---

## Main `authenticate()` Function

```typescript
async function authenticate(request: Request, env: Env): Promise<RequestContext> {
  const auth = request.headers.get("Authorization");
  const deployToken = request.headers.get("X-Orun-Deploy-Token");

  // Bootstrap-only deploy token
  if (deployToken) {
    if (deployToken !== env.ORUN_DEPLOY_TOKEN) throw new OrunError("UNAUTHORIZED");
    return { type: "deploy", namespace: null, allowedNamespaceIds: ["*"], actor: "system" };
  }

  if (!auth?.startsWith("Bearer ")) {
    throw new OrunError("UNAUTHORIZED", "Missing authorization header");
  }
  const token = auth.slice(7);

  // Detect token type by checking issuer claim (without full verification)
  const isOIDC = looksLikeOIDC(token);  // check iss claim without full verify

  if (isOIDC) {
    const claims = await verifyOIDCToken(token, env);
    const namespace = extractNamespaceFromOIDC(claims);
    // Lazily update namespace slug in D1
    ctx.waitUntil(upsertNamespaceSlug(env.DB, namespace));
    return { type: "oidc", namespace, allowedNamespaceIds: [namespace.namespaceId], actor: claims.actor };
  } else {
    const claims = await verifySessionToken(token, env.ORUN_SESSION_SECRET);
    return { type: "session", namespace: null, allowedNamespaceIds: claims.allowedNamespaceIds, actor: claims.sub };
  }
}
```

---

## Namespace Slug Lazy Update

When a token arrives with a different `namespaceSlug` than what's in D1, update the slug asynchronously:

```typescript
async function upsertNamespaceSlug(db: D1Database, namespace: Namespace): Promise<void> {
  await db.prepare(`
    INSERT INTO namespaces (namespace_id, namespace_slug, last_seen_at)
    VALUES (?, ?, ?)
    ON CONFLICT(namespace_id) DO UPDATE SET
      namespace_slug = excluded.namespace_slug,
      last_seen_at = excluded.last_seen_at
  `).bind(namespace.namespaceId, namespace.namespaceSlug, new Date().toISOString()).run();
}
```

This ensures that even after a repo rename or org transfer, the stored slug stays current without any explicit migration.

---

## JWKS Caching Strategy

JWKS verification requires fetching from GitHub. Cache aggressively:

1. In-memory cache (per Worker isolate): TTL 15 minutes
2. KV fallback (optional, for cold starts): TTL 15 minutes

```typescript
let jwksCache: { value: JsonWebKeySet; expiresAt: number } | null = null;

async function getCachedJWKS(jwksUrl: string, env: Env): Promise<JsonWebKeySet> {
  if (jwksCache && jwksCache.expiresAt > Date.now()) {
    return jwksCache.value;
  }
  const jwks = await fetchJWKS(jwksUrl);
  jwksCache = { value: jwks, expiresAt: Date.now() + 15 * 60 * 1000 };
  return jwks;
}
```

---

## Security Requirements

- Never log tokens or secrets
- JWT expiry must be strictly enforced (reject expired tokens even if signature valid)
- Clock skew tolerance: +60 seconds maximum for `iat`, 0 for `exp`
- OIDC audience must exactly match `env.GITHUB_OIDC_AUDIENCE`
- OIDC issuer must exactly match `"https://token.actions.githubusercontent.com"`
- Session tokens have 1-hour TTL; no refresh tokens in Phase 1

---

## Testing Requirements

- Unit test `verifyOIDCToken` with valid and invalid JWTs
- Unit test `verifySessionToken` with valid, expired, and tampered JWTs
- Unit test `authenticate()` with both token types
- Test CSRF state verification in OAuth callback
- Test slug upsert idempotency
