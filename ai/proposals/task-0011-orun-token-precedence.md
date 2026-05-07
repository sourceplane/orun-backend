# Proposal

Task-0011 ORUN_TOKEN precedence over stored CLI session credentials

# Found By

Task 0011 Verifier

# Related Task

Task 0011

# Current Spec Text / Contract

`spec/09-cli-integration.md` section "Token resolution" defines the following order:

1. In GitHub Actions, use GitHub OIDC
2. Outside GitHub Actions, use stored Orun CLI access token (with refresh if expired)
3. If no login and interactive, prompt to run `orun auth login`
4. If no login and non-interactive, fail with device flow hint
5. `ORUN_TOKEN` as explicit fallback for short-lived Orun machine tokens in unknown CI

`website/docs/cli/orun-run.md` and `website/docs/examples/remote-state-matrix.md` both document:

1. GitHub Actions OIDC
2. Local Orun CLI session
3. `ORUN_TOKEN`

# Repo Reality / New Information

The implementation in `internal/remotestate/auth.go` (`ResolveAuth`) uses this order:

1. GitHub Actions OIDC (when `ACTIONS_ID_TOKEN_REQUEST_URL` is set under `GITHUB_ACTIONS=true`)
2. `ORUN_TOKEN` env var (explicit static token)
3. Stored Orun CLI session credentials (with auto-refresh)

The implementer report correctly documents the deviation. The docs were not updated to match the code; they still describe the spec order (CLI session before `ORUN_TOKEN`).

# Proposed Spec Change

Update `spec/09-cli-integration.md` and affected docs to reflect the implemented order:

1. GitHub Actions OIDC
2. `ORUN_TOKEN` (explicit machine token or CI fallback)
3. Stored Orun CLI session credentials (with auto-refresh)
4. No login + interactive: prompt to run `orun auth login`
5. No login + non-interactive: fail with device flow hint

**Rationale**: Placing `ORUN_TOKEN` before the CLI session is arguably safer for automation:
- `ORUN_TOKEN` is an explicit, intentionally-set short-lived token. It should win over a stale stored session.
- A CI system that sets `ORUN_TOKEN` should not silently fall through to a developer's stored local session.
- The stored CLI session is for interactive human use; `ORUN_TOKEN` is for automation. Explicit beats ambient.

In normal interactive local developer use, `ORUN_TOKEN` is not set, so the effective behavior for the primary human use case is identical.

# Why This Is Needed

- The docs and spec currently describe behavior that differs from what the code does.
- A developer reading the docs would expect their CLI session to be used if `ORUN_TOKEN` is also set in the environment. The code does the opposite.
- Without a proposal, this remains undocumented drift that could confuse future maintainers.

# Impacted Files / Tasks

- `spec/09-cli-integration.md` — update token resolution order
- `website/docs/cli/orun-run.md` — update auth resolution order section
- `website/docs/examples/remote-state-matrix.md` — update auth resolution order section

# Compatibility / Migration Notes

No behavior change required. The code already implements `ORUN_TOKEN` at position 2. This proposal authorizes that ordering and updates the docs to match.

# Recommendation

Accept. Update `spec/09-cli-integration.md` and the two docs pages to document the implemented order. No code change needed. This can be bundled into Task 0012 as a small docs-only cleanup or done as a standalone spec update.
