import { describe, it, expectTypeOf } from "vitest";
import type {
  Namespace,
  RunStatus,
  Run,
  JobStatus,
  Job,
  PlanJob,
  PlanStep,
  Plan,
  CreateRunRequest,
  CreateRunResponse,
  ClaimJobRequest,
  ClaimResult,
  UpdateJobRequest,
  HeartbeatRequest,
  HeartbeatResponse,
  RunnableJobsResponse,
  WriteLogRequest,
  ReadLogResponse,
  OIDCClaims,
  SessionClaims,
  ErrorCode,
  ApiError,
  Env,
} from "./index";

describe("type exports", () => {
  it("RunStatus literals", () => {
    expectTypeOf<RunStatus>().toEqualTypeOf<"pending" | "running" | "completed" | "failed" | "cancelled">();
  });

  it("JobStatus literals", () => {
    expectTypeOf<JobStatus>().toEqualTypeOf<"pending" | "running" | "success" | "failed" | "skipped">();
  });

  it("Namespace shape", () => {
    expectTypeOf<Namespace>().toHaveProperty("namespaceId");
    expectTypeOf<Namespace>().toHaveProperty("namespaceSlug");
  });

  it("Run shape", () => {
    expectTypeOf<Run>().toHaveProperty("runId");
    expectTypeOf<Run>().toHaveProperty("namespace");
    expectTypeOf<Run>().toHaveProperty("status");
    expectTypeOf<Run>().toHaveProperty("dryRun");
    expectTypeOf<Run>().toHaveProperty("expiresAt");
  });

  it("Job shape", () => {
    expectTypeOf<Job>().toHaveProperty("jobId");
    expectTypeOf<Job>().toHaveProperty("deps");
    expectTypeOf<Job>().toHaveProperty("heartbeatAt");
  });

  it("Plan shape", () => {
    expectTypeOf<Plan>().toHaveProperty("checksum");
    expectTypeOf<Plan>().toHaveProperty("jobs");
  });

  it("PlanJob shape", () => {
    expectTypeOf<PlanJob>().toHaveProperty("steps");
  });

  it("PlanStep shape", () => {
    expectTypeOf<PlanStep>().toHaveProperty("uses");
    expectTypeOf<PlanStep>().toHaveProperty("with");
  });

  it("API payloads", () => {
    expectTypeOf<CreateRunRequest>().toHaveProperty("plan");
    expectTypeOf<CreateRunRequest>().toHaveProperty("runId");
    expectTypeOf<CreateRunResponse>().toHaveProperty("runId");
    expectTypeOf<ClaimJobRequest>().toHaveProperty("runnerId");
    expectTypeOf<UpdateJobRequest>().toHaveProperty("status");
    expectTypeOf<HeartbeatRequest>().toHaveProperty("runnerId");
    expectTypeOf<HeartbeatResponse>().toHaveProperty("ok");
    expectTypeOf<RunnableJobsResponse>().toHaveProperty("jobs");
    expectTypeOf<WriteLogRequest>().toHaveProperty("content");
    expectTypeOf<ReadLogResponse>().toHaveProperty("logRef");
  });

  it("ClaimResult discriminated union", () => {
    const claimed: ClaimResult = { claimed: true, takeover: false };
    const notClaimed: ClaimResult = { claimed: false, currentStatus: "running" };
    expectTypeOf(claimed).toMatchTypeOf<ClaimResult>();
    expectTypeOf(notClaimed).toMatchTypeOf<ClaimResult>();
  });

  it("Auth types", () => {
    expectTypeOf<OIDCClaims>().toHaveProperty("repository_id");
    expectTypeOf<SessionClaims>().toHaveProperty("allowedNamespaceIds");
  });

  it("Error types", () => {
    expectTypeOf<ErrorCode>().toMatchTypeOf<string>();
    expectTypeOf<ApiError>().toHaveProperty("code");
  });

  it("Env interface", () => {
    expectTypeOf<Env>().toHaveProperty("COORDINATOR");
    expectTypeOf<Env>().toHaveProperty("RATE_LIMITER");
    expectTypeOf<Env>().toHaveProperty("STORAGE");
    expectTypeOf<Env>().toHaveProperty("DB");
    expectTypeOf<Env>().toHaveProperty("GITHUB_JWKS_URL");
    expectTypeOf<Env>().toHaveProperty("GITHUB_OIDC_AUDIENCE");
    expectTypeOf<Env>().toHaveProperty("ORUN_SESSION_SECRET");
    expectTypeOf<Env>().toHaveProperty("ORUN_DEPLOY_TOKEN");
    expectTypeOf<Env>().toHaveProperty("GITHUB_CLIENT_ID");
    expectTypeOf<Env>().toHaveProperty("GITHUB_CLIENT_SECRET");
    expectTypeOf<Env>().toHaveProperty("ORUN_PUBLIC_URL");
  });
});
