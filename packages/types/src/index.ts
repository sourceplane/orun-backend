import type { DurableObjectNamespace, R2Bucket, D1Database } from "@cloudflare/workers-types";

// ─── Core Domain Types ───────────────────────────────────────────────────────

export interface Namespace {
  namespaceId: string;
  namespaceSlug: string;
}

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface Run {
  runId: string;
  namespace: Namespace;
  status: RunStatus;
  planChecksum: string;
  triggerType: "ci" | "manual" | "api";
  actor: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  jobTotal: number;
  jobDone: number;
  jobFailed: number;
  dryRun: boolean;
  expiresAt: string;
}

export type JobStatus = "pending" | "running" | "success" | "failed" | "skipped";

export interface Job {
  jobId: string;
  runId: string;
  component: string;
  status: JobStatus;
  deps: string[];
  runnerId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  heartbeatAt: string | null;
  logRef: string | null;
}

export interface PlanStep {
  stepId: string;
  uses: string;
  with: Record<string, unknown>;
  timeout?: number;
}

export interface PlanJob {
  jobId: string;
  component: string;
  deps: string[];
  steps: PlanStep[];
}

export interface Plan {
  checksum: string;
  version: string;
  jobs: PlanJob[];
  createdAt: string;
}

// ─── API Request / Response Payloads ─────────────────────────────────────────

export interface CreateRunRequest {
  plan: Plan;
  dryRun?: boolean;
  triggerType?: "ci" | "manual" | "api";
  actor?: string;
}

export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
  createdAt: string;
}

export interface ClaimJobRequest {
  runnerId: string;
}

export type ClaimResult =
  | { claimed: true; takeover?: boolean }
  | { claimed: false; currentStatus: JobStatus };

export interface UpdateJobRequest {
  status: "success" | "failed";
  error?: string;
}

export interface HeartbeatRequest {
  runnerId: string;
}

export interface HeartbeatResponse {
  ok: boolean;
  abort?: boolean;
}

export interface RunnableJobsResponse {
  jobs: string[];
}

export interface WriteLogRequest {
  content: string;
}

export interface ReadLogResponse {
  content: string;
  logRef: string;
}

// ─── Auth Types ──────────────────────────────────────────────────────────────

export interface OIDCClaims {
  repository: string;
  repository_id: string;
  repository_owner: string;
  repository_owner_id: string;
  actor: string;
  aud: string;
  iss: string;
  exp: number;
  iat: number;
}

export interface SessionClaims {
  sub: string;
  allowedNamespaceIds: string[];
  exp: number;
  iat: number;
}

// ─── Error Types ─────────────────────────────────────────────────────────────

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR";

export interface ApiError {
  error: string;
  code: ErrorCode;
}

// ─── Worker Environment ──────────────────────────────────────────────────────

export interface Env {
  COORDINATOR: DurableObjectNamespace;
  STORAGE: R2Bucket;
  DB: D1Database;
  GITHUB_JWKS_URL: string;
  GITHUB_OIDC_AUDIENCE: string;
  ORUN_DEPLOY_TOKEN?: string;
}
