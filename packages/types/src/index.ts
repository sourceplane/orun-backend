import type { DurableObjectNamespace, R2Bucket, D1Database } from "@cloudflare/workers-types";

// ─── Core Domain Types ───────────────────────────────────────────────────────

export interface Namespace {
  namespaceId: string;
  namespaceSlug: string;
  kind?: "repo" | "local";
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
  runId?: string;
  repoFullName?: string;
  dryRun?: boolean;
  triggerType?: "ci" | "manual" | "api";
  actor?: string;
}

export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
  createdAt: string;
}

export interface LinkRepoFromSessionResponse {
  namespaceKind: "local";
  namespaceId: string;
  namespaceSlug: string;
  repoId: string;
  repoFullName: string;
  linkedAt: string;
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
  sessionKind?: "dashboard" | "cli";
  tokenUse?: "access";
  githubUserId?: string;
  exp: number;
  iat: number;
}

export interface CliSession {
  sessionId: string;
  accountId: string;
  githubLogin: string;
  allowedNamespaceIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  userAgent: string | null;
  deviceLabel: string | null;
}

export interface CreateCliSessionInput {
  sessionId: string;
  accountId: string;
  githubLogin: string;
  refreshTokenHash: string;
  allowedNamespaceIds: string[];
  expiresAt: string;
  userAgent?: string;
  deviceLabel?: string;
}

// ─── Catalog Types ───────────────────────────────────────────────────────────

export type CatalogComponentStatus = "healthy" | "failing" | "stale" | "unknown";

export type CatalogRelationType =
  | "depends_on"
  | "provides_api"
  | "consumes_api"
  | "uses_resource"
  | "deploys_with";

export type CatalogRelationTargetKind =
  | "component"
  | "api"
  | "resource"
  | "composition"
  | "job";

export interface CatalogEnvironmentState {
  name: string;
  status?: CatalogComponentStatus;
  latestJobId?: string;
}

export interface CatalogComponentRelation {
  relationType: CatalogRelationType;
  targetKind: CatalogRelationTargetKind;
  targetRef: string;
  environment?: string;
  jobId?: string;
}

export interface ComponentState {
  apiVersion: "orun.io/v1";
  kind: "ComponentState";
  source: {
    provider: "github";
    repository: string;
    repoId: string;
    branch?: string;
    commit: string;
    workflowRunId?: string;
    workflowRef?: string;
    prNumber?: number;
  };
  component: {
    id: string;
    name: string;
    title?: string;
    description?: string;
    type: string;
    owner?: string;
    system?: string;
    lifecycle?: string;
    tags: string[];
    path: string;
  };
  environments: CatalogEnvironmentState[];
  relations: CatalogComponentRelation[];
  plan?: {
    planId?: string;
    checksum: string;
    changed: boolean;
    affectedJobs: string[];
  };
  pr?: {
    number: number;
    title?: string;
    changedFiles: string[];
  };
  generatedAt: string;
}

export interface CatalogSyncEnvelope {
  apiVersion: "orun.io/v1";
  kind: "CatalogSyncEnvelope";
  uploadId: string;
  schemaVersion: string;
  source: {
    provider: "github";
    repo: string;
    repoId: string;
    commit: string;
    branch?: string;
    workflowRunId?: string;
    workflowRef?: string;
    prNumber?: number;
  };
  plan?: {
    id?: string;
    checksum: string;
    objectRef?: string;
  };
  components: ComponentState[];
  generatedAt: string;
}

export interface CatalogSyncAccepted {
  uploadId: string;
  acceptedAt: string;
  componentCount: number;
}

export interface CatalogComponentSummary {
  componentId: string;
  namespace: Namespace;
  repoId: string;
  repoFullName: string;
  name: string;
  title?: string;
  description?: string;
  type: string;
  owner?: string;
  system?: string;
  lifecycle?: string;
  repoPath: string;
  tags: string[];
  environments: CatalogEnvironmentState[];
  latestPlanId?: string;
  latestPlanChecksum?: string;
  latestCommitSha: string;
  latestStatus: CatalogComponentStatus;
  currentStateRef: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface CatalogComponentDetail extends CatalogComponentSummary {
  relations: CatalogComponentRelation[];
}

export interface CatalogComponentEvent {
  eventId: string;
  componentId: string;
  namespace: Namespace;
  uploadId: string;
  eventType: "created" | "updated" | "changed" | "pr_changed" | "synced";
  commitSha: string;
  prNumber?: number;
  summary?: string;
  payloadRef?: string;
  createdAt: string;
}

export interface CatalogComponentListResponse {
  components: CatalogComponentSummary[];
  total: number;
}

export interface CatalogComponentRelationsResponse {
  outgoing: CatalogComponentRelation[];
  incoming: Array<CatalogComponentRelation & { sourceComponentId: string; sourceName: string }>;
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

// ─── Storage Routing Types ────────────────────────────────────────────────────

export interface CatalogIngestMessage {
  namespaceId: string;
  repoId: string;
  repoFullName: string;
  uploadId: string;
  envelopeRef: string;
  commitSha: string;
  receivedAt: string;
}

export interface CatalogQueue {
  send(message: CatalogIngestMessage): Promise<void>;
}

// ─── Worker Environment ──────────────────────────────────────────────────────

export interface Env {
  COORDINATOR: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
  STORAGE: R2Bucket;
  DB: D1Database;
  GITHUB_JWKS_URL: string;
  GITHUB_OIDC_AUDIENCE: string;
  ORUN_SESSION_SECRET?: string;
  ORUN_DEPLOY_TOKEN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  ORUN_PUBLIC_URL?: string;
  ORUN_DASHBOARD_URL?: string;
  GITHUB_DEVICE_CLIENT_ID?: string;
  // Optional catalog ingest queue — when present, catalog sync enqueues R2-ref messages
  CATALOG_INGEST_QUEUE?: CatalogQueue;
  // Optional bounded catalog shard D1 bindings — when absent, DB is the fallback
  DB_CATALOG_0?: D1Database;
  DB_CATALOG_1?: D1Database;
}
