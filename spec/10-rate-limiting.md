# Spec 09 — Rate Limiting

## Scope

Rate limiting protects the system from abuse and enforces fair usage tiers. It runs in the Worker before any handler is dispatched.

**Agent task**: Implement `packages/worker/src/ratelimit.ts`.

---

## Tiers

| Tier | Condition | Concurrent jobs | RPS |
|------|-----------|----------------|-----|
| `free` | No account linked | 10 | 5 |
| `premium` | Account linked to paid plan | 100 | 100 |

Tier is determined by querying D1:

```typescript
async function getTier(namespaceId: string, db: D1Database): Promise<"free" | "premium"> {
  const result = await db.prepare(`
    SELECT a.tier FROM accounts a
    JOIN account_repos ar ON ar.account_id = a.account_id
    WHERE ar.namespace_id = ?
    LIMIT 1
  `).bind(namespaceId).first<{ tier: string }>();
  return result?.tier === "premium" ? "premium" : "free";
}
```

---

## Implementation Options

Agents may choose **any** of the following implementations. The key requirement is per-namespace enforcement:

### Option A: Cloudflare Rate Limiting API (Recommended)

Use the Cloudflare Workers Rate Limiting API (available on Workers Paid plan):

```typescript
// wrangler.jsonc:
[[unsafe.bindings]]
name = "RATE_LIMITER"
type = "ratelimit"
namespace_id = "1001"
simple = { limit = 5, period = 1 }

// In worker:
async function rateLimit(namespaceId: string, env: any): Promise<void> {
  const { success } = await env.RATE_LIMITER.limit({ key: namespaceId });
  if (!success) throw new OrunError("RATE_LIMITED", "Too many requests");
}
```

### Option B: KV Sliding Window

```typescript
async function rateLimit(namespaceId: string, tier: RateLimitTier, env: Env): Promise<void> {
  const window = 1000; // ms
  const limit = tier === "premium" ? 100 : 5;
  const key = `rl:${namespaceId}:${Math.floor(Date.now() / window)}`;

  const current = parseInt(await env.KV.get(key) ?? "0");
  if (current >= limit) throw new OrunError("RATE_LIMITED");

  await env.KV.put(key, String(current + 1), { expirationTtl: 2 });
}
```

### Option C: DO Counter (Alternative)

A lightweight Durable Object `RateLimitCounter` keyed by `namespaceId`, maintaining a sliding window counter.

---

## D1 Query Caching

Tier lookups hit D1 on every request. Cache for 60 seconds per namespace:

```typescript
const tierCache = new Map<string, { tier: "free" | "premium"; expiresAt: number }>();

async function getCachedTier(namespaceId: string, db: D1Database): Promise<"free" | "premium"> {
  const cached = tierCache.get(namespaceId);
  if (cached && cached.expiresAt > Date.now()) return cached.tier;

  const tier = await getTier(namespaceId, db);
  tierCache.set(namespaceId, { tier, expiresAt: Date.now() + 60_000 });
  return tier;
}
```

---

## Rate Limit Response

When rate limited, return:
```json
HTTP 429
{
  "error": "Too many requests",
  "code": "RATE_LIMITED"
}
```

With headers:
```
Retry-After: 1
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
```
