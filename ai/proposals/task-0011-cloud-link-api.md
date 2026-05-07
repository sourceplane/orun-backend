# Proposal

Task-0011 backend repo-link creation API for CLI sessions

# Found By

Task 0011 Implementer (confirmed by Task 0011 Verifier)

# Related Task

Task 0011

# Current Spec Text / Contract

`spec/09-cli-integration.md` describes `orun cloud link` behavior:

1. Ensure the user is logged in
2. Detect the current GitHub remote
3. Verify the GitHub repo namespace is present in the Orun session or linked account
4. Persist backend URL and repo linkage in local orun config
5. Print a concise success summary

The intent implies that `orun cloud link` can fully link a repo to the Orun account from the CLI.

# Repo Reality / New Information

The existing backend `POST /v1/accounts/repos` route requires an `X-GitHub-Access-Token` header containing a raw GitHub OAuth access token to create a new repo link. The CLI auth flow (browser loopback or device) never stores or returns the GitHub access token to the CLI — GitHub tokens are discarded by the backend after namespace resolution, per the security contract.

Therefore, `orun cloud link` can only:
- Retrieve repos already linked in the backend account via `GET /v1/accounts/repos`
- Persist the namespace ID locally for repos it finds there

It **cannot** create a new backend repo link for a repo that is not already present in the account. For such repos the user sees:

```
repo <owner>/<name> is not linked in this Orun session; link it in Orun Cloud first, then rerun `orun cloud link`
```

This is safe behavior (does not store a GitHub token) but it means `orun cloud link` requires the user to have linked the repo via the dashboard first.

# Proposed Spec Change

Add a new backend endpoint for session-authenticated repo-link creation/resolution:

```text
POST /v1/accounts/repos/link
  Authorization: Bearer <orun-cli-access-token>
  { repoFullName: "owner/repo" }
  -> { namespaceId, namespaceSlug, linkedAt }
```

The backend would:
1. Verify the Orun CLI session has an allowed namespace ID corresponding to `repoFullName`.
2. Look up or create the `account_repos` row using the session's linked namespace data.
3. Return the namespace ID and slug without requiring the CLI to forward a GitHub access token.

Alternatively, expose a lookup endpoint that resolves a repo slug to a namespace ID from the CLI session's `allowedNamespaceIds`:

```text
GET /v1/accounts/repos?slug=owner/repo
  Authorization: Bearer <orun-cli-access-token>
  -> { repos: [{ namespaceId, namespaceSlug, linkedAt }] }
```

# Why This Is Needed

- Local `orun run --remote-state` requires a `namespaceId` in `POST /v1/runs`.
- The CLI derives the namespace ID from the repo link stored in `~/.orun/config.yaml`.
- If the repo is not already linked via the dashboard, `orun cloud link` cannot derive the namespace ID, so `orun run --remote-state` will fail for new users who have not yet used the dashboard.
- The fix closes the bootstrapping gap and makes `orun cloud link` fully self-service from the CLI.

# Impacted Files / Tasks

- `apps/worker/src/handlers/accounts.ts` — new endpoint or extended GET
- `apps/worker/src/api.test.ts` — new test cases
- `spec/04-worker-api.md` — API table update
- `spec/09-cli-integration.md` — `orun cloud link` description update
- `sourceplane/orun` `cmd/orun/command_cloud.go` — remove "link it in Orun Cloud first" fallback message
- `website/docs/cli/orun-cloud.md` — update behavior description

# Compatibility / Migration Notes

The existing `POST /v1/accounts/repos` with `X-GitHub-Access-Token` can remain for the dashboard flow. The new session-authenticated path is an additional route.

# Recommendation

Accept and schedule as Task 0012.1 (backend) + small CLI update, or bundle into Task 0012 if the conformance work requires end-to-end local `orun cloud link` to succeed without prior dashboard setup.
