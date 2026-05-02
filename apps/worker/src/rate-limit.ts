import type { Env } from "@orun/types";
import { errorJson } from "./http";

const WINDOW_MS = 1000;
const MAX_TOKENS = 20;
const REFILL_RATE = 5;

export class RateLimitCounter {
  private tokens: number = MAX_TOKENS;
  private lastRefill: number = Date.now();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refillCount = Math.floor(elapsed / WINDOW_MS) * REFILL_RATE;
    if (refillCount > 0) {
      this.tokens = Math.min(MAX_TOKENS, this.tokens + refillCount);
      this.lastRefill = now;
    }

    if (this.tokens <= 0) {
      return new Response(
        JSON.stringify({ remaining: 0, limited: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    this.tokens--;
    return new Response(
      JSON.stringify({ remaining: this.tokens, limited: false }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
}

export async function checkRateLimit(env: Env, namespaceId: string): Promise<Response | null> {
  const id = env.RATE_LIMITER.idFromName(namespaceId);
  const stub = env.RATE_LIMITER.get(id);
  const resp = await stub.fetch(new Request("https://rate-limiter.local/check"));
  const data = await resp.json() as { remaining: number; limited: boolean };

  if (data.limited) {
    return errorJson("RATE_LIMITED", "Rate limit exceeded", 429, {
      "Retry-After": "1",
      "X-RateLimit-Limit": String(MAX_TOKENS),
      "X-RateLimit-Remaining": "0",
    });
  }

  return null;
}
