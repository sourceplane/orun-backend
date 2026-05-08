# Open Risks

## Current Repo Health

- Repo health is yellow because original Task 0012 local conformance verification
  failed and Task 0012.1 has no verifier report. Later namespace/linking
  follow-ups passed, but the whole local conformance phase should be re-verified
  before marking health green.

## Live And Deployment Verification

- Task 0015 live Cloudflare smoke was not run. Direct REST bootstrap is covered
  by fake-server tests and dry-run smokes, but live provisioning should still be
  tested with disposable Cloudflare resources.
- Task 0015 verifier noted `SetWorkerVars` PATCH binding behavior remains
  unverified live.
- Worker cron trigger configuration is not implemented by CLI bootstrap.

## Auth And Session Follow-Ups

- Device-flow endpoint rate limiting was deferred from Task 0010.
- Refresh tokens are not rotated.
- CLI session garbage collection remains deferred.
- `orun cloud link` cannot create new backend repo links without prior dashboard
  setup.
- `orun cloud link --backend-url` is missing; use `ORUN_BACKEND_URL` as the
  current workaround.
- `orun auth token --audience` is display-only.

## Dashboard QA

- Full interactive live visual QA across desktop/tablet/mobile was deferred for
  the dashboard. Run browser checks before relying on the dashboard as visually
  production-ready.
