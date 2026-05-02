import type { Plan, JobStatus } from "@orun/types";

const HEARTBEAT_TIMEOUT_MS = 300_000;
const EXPIRY_DELAY_MS = 24 * 60 * 60 * 1000;

export interface RunState {
  runId: string;
  namespaceId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  plan: Plan;
  jobs: Record<string, JobState>;
  createdAt: string;
  updatedAt: string;
}

export interface JobState {
  jobId: string;
  component: string;
  status: JobStatus;
  deps: string[];
  runnerId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  lastError: string | null;
  heartbeatAt: string | null;
}

export interface CoordinatorClaimResult {
  claimed: boolean;
  takeover?: boolean;
  currentStatus?: JobStatus;
  depsBlocked?: boolean;
  depsWaiting?: boolean;
}

export interface CoordinatorUpdateJobRequest {
  runnerId: string;
  status: "success" | "failed";
  error?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(error: string, code: string, status: number): Response {
  return jsonResponse({ error, code }, status);
}

export class RunCoordinator {
  private runState: RunState | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  private async loadState(): Promise<RunState | null> {
    if (this.runState !== null) return this.runState;
    this.runState =
      (await this.state.storage.get<RunState>("runState")) ?? null;
    return this.runState;
  }

  private async persistState(): Promise<void> {
    if (this.runState) {
      await this.state.storage.put("runState", this.runState);
    }
  }

  private async scheduleExpiry(): Promise<void> {
    const alarm = await this.state.storage.getAlarm();
    if (!alarm) {
      await this.state.storage.setAlarm(Date.now() + EXPIRY_DELAY_MS);
    }
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
    this.runState = null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    try {
      if (method === "POST" && path === "/init") {
        return this.handleInit(request);
      }

      const jobMatch = path.match(
        /^\/jobs\/([^/]+)\/(claim|update|heartbeat|status)$/,
      );
      if (jobMatch) {
        const jobId = decodeURIComponent(jobMatch[1]);
        const action = jobMatch[2];
        if (action === "claim" && method === "POST")
          return this.handleClaim(jobId, request);
        if (action === "update" && method === "POST")
          return this.handleUpdate(jobId, request);
        if (action === "heartbeat" && method === "POST")
          return this.handleHeartbeat(jobId, request);
        if (action === "status" && method === "GET")
          return this.handleJobStatus(jobId);
        return errorResponse("Method not allowed", "INVALID_REQUEST", 400);
      }

      if (method === "GET" && path === "/runnable") {
        return this.handleRunnable();
      }

      if (method === "GET" && path === "/state") {
        return this.handleState();
      }

      if (method === "POST" && path === "/cancel") {
        return this.handleCancel();
      }

      return errorResponse("Not found", "NOT_FOUND", 404);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Internal server error";
      return errorResponse(message, "INTERNAL_ERROR", 500);
    }
  }

  private async handleInit(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", "INVALID_REQUEST", 400);
    }

    const { plan, runId, namespaceId, namespaceSlug } = body as {
      plan: Plan;
      runId: string;
      namespaceId: string;
      namespaceSlug: string;
    };

    if (!plan || !runId || !namespaceId) {
      return errorResponse(
        "Missing required fields: plan, runId, namespaceId",
        "INVALID_REQUEST",
        400,
      );
    }

    if (!Array.isArray(plan.jobs)) {
      return errorResponse("plan.jobs must be an array", "INVALID_REQUEST", 400);
    }

    const jobIds = new Set<string>();
    for (const job of plan.jobs) {
      if (!job.jobId || typeof job.jobId !== "string") {
        return errorResponse(
          "Every plan job must have a non-empty jobId",
          "INVALID_REQUEST",
          400,
        );
      }
      if (jobIds.has(job.jobId)) {
        return errorResponse(
          `Duplicate jobId: ${job.jobId}`,
          "INVALID_REQUEST",
          400,
        );
      }
      jobIds.add(job.jobId);
    }

    for (const job of plan.jobs) {
      if (job.deps) {
        for (const dep of job.deps) {
          if (!jobIds.has(dep)) {
            return errorResponse(
              `Dependency "${dep}" in job "${job.jobId}" does not exist in plan`,
              "INVALID_REQUEST",
              400,
            );
          }
        }
      }
    }

    const existing = await this.loadState();

    if (existing) {
      if (existing.runId === runId) {
        return jsonResponse({ ok: true, alreadyExists: true });
      }
      return errorResponse(
        `Coordinator already initialized for runId: ${existing.runId}`,
        "CONFLICT",
        409,
      );
    }

    const now = new Date().toISOString();
    const jobs: Record<string, JobState> = {};
    for (const pj of plan.jobs) {
      jobs[pj.jobId] = {
        jobId: pj.jobId,
        component: pj.component,
        status: "pending",
        deps: pj.deps ?? [],
        runnerId: null,
        startedAt: null,
        finishedAt: null,
        lastError: null,
        heartbeatAt: null,
      };
    }

    this.runState = {
      runId,
      namespaceId,
      status: "running",
      plan,
      jobs,
      createdAt: now,
      updatedAt: now,
    };

    await this.persistState();
    return jsonResponse({ ok: true, alreadyExists: false });
  }

  private async handleClaim(
    jobId: string,
    request: Request,
  ): Promise<Response> {
    const state = await this.loadState();
    if (!state) {
      return errorResponse("Coordinator not initialized", "NOT_FOUND", 404);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", "INVALID_REQUEST", 400);
    }

    const { runnerId } = body as { runnerId: string };
    if (!runnerId || typeof runnerId !== "string") {
      return errorResponse("Missing runnerId", "INVALID_REQUEST", 400);
    }

    const job = state.jobs[jobId];
    if (!job) {
      return errorResponse(`Job not found: ${jobId}`, "NOT_FOUND", 404);
    }

    if (job.status === "pending") {
      for (const dep of job.deps) {
        const depJob = state.jobs[dep];
        if (depJob.status === "failed") {
          return jsonResponse({
            claimed: false,
            currentStatus: "pending",
            depsBlocked: true,
          } satisfies CoordinatorClaimResult);
        }
      }

      for (const dep of job.deps) {
        const depJob = state.jobs[dep];
        if (depJob.status !== "success") {
          return jsonResponse({
            claimed: false,
            currentStatus: "pending",
            depsWaiting: true,
          } satisfies CoordinatorClaimResult);
        }
      }

      const now = new Date().toISOString();
      job.status = "running";
      job.runnerId = runnerId;
      job.startedAt = now;
      job.heartbeatAt = now;
      state.updatedAt = now;
      await this.persistState();
      return jsonResponse({ claimed: true } satisfies CoordinatorClaimResult);
    }

    if (job.status === "running") {
      const now = Date.now();
      const heartbeatAge = job.heartbeatAt
        ? now - new Date(job.heartbeatAt).getTime()
        : Infinity;

      if (heartbeatAge > HEARTBEAT_TIMEOUT_MS) {
        const nowIso = new Date().toISOString();
        job.runnerId = runnerId;
        job.heartbeatAt = nowIso;
        state.updatedAt = nowIso;
        await this.persistState();
        return jsonResponse({
          claimed: true,
          takeover: true,
        } satisfies CoordinatorClaimResult);
      }

      return jsonResponse({
        claimed: false,
        currentStatus: "running",
      } satisfies CoordinatorClaimResult);
    }

    return jsonResponse({
      claimed: false,
      currentStatus: job.status,
    } satisfies CoordinatorClaimResult);
  }

  private async handleUpdate(
    jobId: string,
    request: Request,
  ): Promise<Response> {
    const state = await this.loadState();
    if (!state) {
      return errorResponse("Coordinator not initialized", "NOT_FOUND", 404);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", "INVALID_REQUEST", 400);
    }

    const { runnerId, status, error } = body as CoordinatorUpdateJobRequest;

    if (!runnerId || typeof runnerId !== "string") {
      return errorResponse("Missing runnerId", "INVALID_REQUEST", 400);
    }

    if (status !== "success" && status !== "failed") {
      return errorResponse(
        "status must be 'success' or 'failed'",
        "INVALID_REQUEST",
        400,
      );
    }

    const job = state.jobs[jobId];
    if (!job) {
      return errorResponse(`Job not found: ${jobId}`, "NOT_FOUND", 404);
    }

    if (job.status !== "running") {
      return errorResponse(
        `Job is not running (current: ${job.status})`,
        "INVALID_REQUEST",
        400,
      );
    }

    if (job.runnerId !== runnerId) {
      return errorResponse(
        "Runner does not own this job",
        "INVALID_REQUEST",
        400,
      );
    }

    const now = new Date().toISOString();
    job.status = status;
    job.finishedAt = now;
    job.lastError = error ?? null;
    state.updatedAt = now;

    const allJobs = Object.values(state.jobs);
    const allSuccess = allJobs.every((j) => j.status === "success");
    const anyFailed = allJobs.some((j) => j.status === "failed");

    if (allSuccess) {
      state.status = "completed";
    } else if (anyFailed) {
      state.status = "failed";
    }

    await this.persistState();

    if (state.status === "completed" || state.status === "failed") {
      await this.scheduleExpiry();
    }

    return jsonResponse({ ok: true });
  }

  private async handleHeartbeat(
    jobId: string,
    request: Request,
  ): Promise<Response> {
    const state = await this.loadState();
    if (!state) {
      return errorResponse("Coordinator not initialized", "NOT_FOUND", 404);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse("Invalid JSON body", "INVALID_REQUEST", 400);
    }

    const { runnerId } = body as { runnerId: string };
    if (!runnerId || typeof runnerId !== "string") {
      return errorResponse("Missing runnerId", "INVALID_REQUEST", 400);
    }

    const job = state.jobs[jobId];
    if (!job) {
      return errorResponse(`Job not found: ${jobId}`, "NOT_FOUND", 404);
    }

    if (job.runnerId !== runnerId || job.status !== "running") {
      return jsonResponse({ ok: false, abort: true });
    }

    const now = new Date().toISOString();
    job.heartbeatAt = now;
    state.updatedAt = now;
    await this.persistState();
    return jsonResponse({ ok: true });
  }

  private async handleJobStatus(jobId: string): Promise<Response> {
    const state = await this.loadState();
    if (!state) {
      return errorResponse("Coordinator not initialized", "NOT_FOUND", 404);
    }

    const job = state.jobs[jobId];
    if (!job) {
      return errorResponse(`Job not found: ${jobId}`, "NOT_FOUND", 404);
    }

    return jsonResponse({
      jobId: job.jobId,
      component: job.component,
      status: job.status,
      deps: job.deps,
      runnerId: job.runnerId,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      lastError: job.lastError,
      heartbeatAt: job.heartbeatAt,
    });
  }

  private async handleRunnable(): Promise<Response> {
    const state = await this.loadState();
    if (!state) {
      return errorResponse("Coordinator not initialized", "NOT_FOUND", 404);
    }

    const runnableJobs: string[] = [];
    for (const job of Object.values(state.jobs)) {
      if (job.status !== "pending") continue;
      const allDepsSatisfied = job.deps.every(
        (dep) => state.jobs[dep].status === "success",
      );
      if (allDepsSatisfied) {
        runnableJobs.push(job.jobId);
      }
    }

    return jsonResponse({ jobs: runnableJobs });
  }

  private async handleState(): Promise<Response> {
    const state = await this.loadState();
    if (!state) {
      return errorResponse("Coordinator not initialized", "NOT_FOUND", 404);
    }
    return jsonResponse(state);
  }

  private async handleCancel(): Promise<Response> {
    const state = await this.loadState();
    if (!state) {
      return errorResponse("Coordinator not initialized", "NOT_FOUND", 404);
    }

    const now = new Date().toISOString();

    for (const job of Object.values(state.jobs)) {
      if (job.status === "pending" || job.status === "running") {
        job.status = "failed";
        job.lastError = "cancelled";
        if (!job.finishedAt) {
          job.finishedAt = now;
        }
      }
    }

    state.status = "cancelled";
    state.updatedAt = now;
    await this.persistState();
    await this.scheduleExpiry();

    return jsonResponse({ ok: true });
  }
}
