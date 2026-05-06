# Proposal: Device Flow Endpoint Rate Limiting

## Status

Deferred — accepted residual risk for Task 0010 pre-production phase.

## Problem

`POST /v1/auth/cli/device/start` and `POST /v1/auth/cli/device/poll` were shipped in Task 0010 without per-IP or per-device-code rate limiting. `spec/06-auth.md` requires it:

> Rate-limit device start/poll endpoints by IP and device code.

Without rate limiting, a bad actor could:

1. Call `/device/start` in a tight loop, exhausting the GitHub OAuth app's rate limit for the device authorization endpoint.
2. Call `/device/poll` with a guessed or stolen `deviceCode` value more aggressively than the `slow_down` response allows.

GitHub's own protocol provides partial protection: device codes expire, polling returns `slow_down`, and GitHub limits requests per OAuth app. The immediate blast radius is service degradation (GitHub API rate exhaustion for all users of the OAuth app), not credential exposure.

## Proposed Implementation (Task 0011 or hotfix)

Extend the existing `RateLimitCounter` Durable Object or Cloudflare's built-in Rate Limiting API to cover the device flow endpoints:

- **`POST /v1/auth/cli/device/start`**: limit by IP — e.g., 10 requests per minute per IP.
- **`POST /v1/auth/cli/device/poll`**: limit by `deviceCode` value (extracted from request body) — e.g., 60 requests per minute per code, enforcing the `interval` returned by `/start`. Also limit by IP as a fallback.

The existing `checkRateLimit` function in `apps/worker/src/rate-limit.ts` uses a Durable Object keyed by `namespaceId`. For unauthenticated endpoints, key by IP header (`CF-Connecting-IP`) or request.headers.get("CF-Connecting-IP").

## Acceptance

Accepted as an acknowledged gap for Task 0010. Pre-production traffic only. Must be addressed before general availability of the CLI.

## Reference

- Task 0010 implementer report: `/ai/reports/task-0010-implementer.md` — "Remaining Gaps" section.
- Task 0010 verifier report: `/ai/reports/task-0010-verifier.md`.
