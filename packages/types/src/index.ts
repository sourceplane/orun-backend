export type RunStatus = "pending" | "running" | "success" | "failure" | "cancelled";

export type JobStatus = "pending" | "queued" | "running" | "success" | "failure" | "skipped";

export interface Namespace {
  namespaceId: string;
  namespaceSlug: string;
}

export interface ApiError {
  error: string;
  code: string;
}

export interface Env {
  COORDINATOR: DurableObjectNamespace;
  STORAGE: R2Bucket;
  DB: D1Database;
  GITHUB_JWKS_URL: string;
  GITHUB_OIDC_AUDIENCE: string;
  ORUN_DEPLOY_TOKEN?: string;
}
