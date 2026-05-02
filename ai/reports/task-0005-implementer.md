# Task 0005 Implementer Report

## Summary

Implemented the Worker authentication module at `apps/worker/src/auth/`. The module provides GitHub Actions OIDC JWT verification, orun session JWT issuance/verification, GitHub OAuth helpers, deploy-token bootstrap auth, namespace extraction with lazy D1 slug upsert, and a typed `authenticate()` function returning `RequestContext`. All auth logic uses Web Crypto with zero external dependencies.

## Files Changed

### New files

| File | Purpose |
|------|---------|
| `apps/worker/src/auth/errors.ts` | `OrunError` class with `ErrorCode` → HTTP status mapping |
| `apps/worker/src/auth/base64url.ts` | Workers-compatible base64url encode/decode (no `Buffer`) |
| `apps/worker/src/auth/jwt.ts` | JWT decode, HMAC sign/verify, JWT builder utilities |
| `apps/worker/src/auth/oidc.ts` | GitHub OIDC verification with JWKS fetch + 15-min cache |
| `apps/worker/src/auth/session.ts` | Session JWT issuance and verification (HS256) |
| `apps/worker/src/auth/github-oauth.ts` | OAuth redirect, signed CSRF state, token exchange, repo/org admin namespace discovery |
| `apps/worker/src/auth/namespace.ts` | `upsertNamespaceSlug()` for lazy D1 updates |
| `apps/worker/src/auth/index.ts` | `authenticate()` function + barrel re-exports |
| `apps/worker/src/auth/base64url.test.ts` | 5 tests |
| `apps/worker/src/auth/oidc.test.ts` | 17 tests |
| `apps/worker/src/auth/session.test.ts` | 11 tests |
| `apps/worker/src/auth/github-oauth.test.ts` | 11 tests |
| `apps/worker/src/auth/namespace.test.ts` | 3 tests |
| `apps/worker/src/auth/index.test.ts` | 8 tests |

### Modified files

| File | Change |
|------|--------|
| `packages/types/src/index.ts` | Added `ORUN_SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ORUN_PUBLIC_URL` to `Env` |
| `packages/types/src/index.test.ts` | Added type tests for new Env fields |
| `spec/06-auth.md` | Updated `authenticate()` signature to include `ctx?: Pick<ExecutionContext, "waitUntil">`; updated CSRF state from KV to stateless signed state |

## Public Exports Added

From `apps/worker/src/auth/index.ts`:

```typescript
export { authenticate, OrunError, verifyOIDCToken, extractNamespaceFromOIDC, looksLikeOIDC,
  issueSessionToken, verifySessionToken, buildGitHubOAuthRedirect, handleGitHubOAuthCallback,
  upsertNamespaceSlug };
export type { RequestContext };
```

## Auth Flows Implemented

1. **OIDC**: Fetches JWKS from `env.GITHUB_JWKS_URL`, caches 15 min, verifies RS256 signature + issuer + audience + expiry + iat skew + required claims. Returns `RequestContext { type: "oidc" }` with namespace.
2. **Session**: Signs/verifies HS256 JWTs with `ORUN_SESSION_SECRET`. Validates sub, allowedNamespaceIds, exp. Returns `RequestContext { type: "session" }`.
3. **Deploy token**: Exact match of `X-Orun-Deploy-Token` against `env.ORUN_DEPLOY_TOKEN`. Returns `RequestContext { type: "deploy", allowedNamespaceIds: ["*"] }`.
4. **GitHub OAuth**: Builds authorize redirect with signed CSRF state, exchanges code for token, fetches user + admin repos + org-admin repos with pagination, deduplicates namespace IDs, issues session JWT.

## Security Choices

| Decision | Rationale |
|----------|-----------|
| Stateless signed CSRF state (HMAC over nonce + expiry) instead of KV | No KV binding in current wrangler.jsonc; signed state is simpler and avoids a storage dependency. 10-minute TTL matches original spec intent. |
| `ctx?.waitUntil` optional in `authenticate()` | Allows the function to work both in Worker runtime (where `ctx` is available) and in unit tests / non-Worker callers. Spec updated accordingly. |
| No external JWT/OAuth libraries | Spec requires Web Crypto only. All JWT operations use `crypto.subtle`. |
| No token/secret logging | `OrunError` messages are generic. No JWT payloads, access tokens, or secrets are logged. |
| New Env fields are optional | `ORUN_SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` are Workers secrets. Runtime helpers throw clear errors when required secrets are missing for the chosen auth path. |

## Spec/Code Deltas Reconciled

1. **`authenticate()` signature**: Spec showed `authenticate(request, env)` with bare `ctx.waitUntil`. Updated spec to `authenticate(request, env, ctx?)` with `ctx?: Pick<ExecutionContext, "waitUntil">`.
2. **CSRF state**: Spec mentioned KV for CSRF state. Implementation uses stateless signed state (HMAC). Spec updated to reflect this.
3. **Spec path**: Spec title says `packages/worker/src/auth/` but actual Worker lives at `apps/worker/`. Implementation uses `apps/worker/src/auth/` per task instructions.

## Tests Added

| File | Count | Coverage |
|------|-------|----------|
| `base64url.test.ts` | 5 | Round-trip binary/string, empty input, no-padding, various lengths |
| `oidc.test.ts` | 17 | Valid RS256, invalid sig, unknown kid, wrong issuer, wrong audience, audience array, expired, future iat, missing claims, malformed, unsupported alg, JWKS cache reuse |
| `session.test.ts` | 11 | Issue+verify, custom TTL, expired, tampered, wrong secret, malformed, missing sub, invalid allowedNamespaceIds, none alg, empty secret (both issue and verify) |
| `github-oauth.test.ts` | 11 | Redirect URL params, ORUN_PUBLIC_URL, exchange+fetch+filter, missing code/state, invalid state, expired state, org admin repos, deduplication, token exchange failure, user fetch failure, pagination |
| `namespace.test.ts` | 3 | Correct params, idempotent, auto timestamp |
| `index.test.ts` | 8 | Deploy context, invalid deploy token, missing auth, OIDC context+upsert, ctx.waitUntil, session context, invalid OIDC, idempotent slug upsert |
| **Total** | **55** | |

## Checks Run

```
$ pnpm exec turbo run typecheck
Tasks: 5 successful, 5 total — PASS

$ pnpm exec turbo run build
Tasks: 5 successful, 5 total — PASS
Worker bundle includes COORDINATOR DO binding, D1, R2, auth env vars

$ pnpm exec turbo run test
@orun/types: 16 passed
@orun/coordinator: 35 passed
@orun/storage: 42 passed
@orun/worker: 55 passed
Total: 148 tests — PASS

$ cd apps/worker && pnpm test
6 files, 55 tests — PASS

$ cd packages/types && pnpm test
2 files, 16 tests — PASS
```

## Local kiox/orun Validation

```
$ kiox -- orun plan --changed
0 components × 3 envs → 0 jobs (expected: no component.yaml changes)

$ kiox -- orun run --changed
0 components × 3 envs → 0 jobs — ✓ no jobs to run
```

## PR

**PR #12**: https://github.com/sourceplane/orun-backend/pull/12

## Remaining Gaps / Risks for Task 0006

1. **No Worker routing implemented**: `authenticate()` is exported but `apps/worker/src/index.ts` still returns a bare `"orun-api"` response. Task 0006 will wire auth into the fetch handler.
2. **No rate limiting**: Rate limiting is Task 0006 scope.
3. **No namespace access enforcement**: `assertNamespaceAccess()` belongs to Worker routing, not auth module.
4. **OAuth routes not wired**: `buildGitHubOAuthRedirect` and `handleGitHubOAuthCallback` are helpers — Task 0006 will mount them on `/v1/auth/github` and `/v1/auth/github/callback`.
5. **D1 tests use fake, not real D1**: Namespace upsert tested with a prepared-statement spy. Consistent with Task 0004 approach.
6. **JWKS cache is per-isolate**: Each Worker isolate has its own JWKS cache. This is expected behavior for Workers — no shared state between isolates.
