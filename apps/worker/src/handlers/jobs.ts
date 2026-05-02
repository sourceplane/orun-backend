import type { Env, Job } from "@orun/types";
import type { RequestContext } from "../auth";
import type { RunState, CoordinatorUpdateJobRequest } from "@orun/coordinator";
import { OrunError } from "../auth/errors";
import { json } from "../http";
import { getCoordinator, coordinatorFetch } from "../coordinator";
import { assertNamespaceAccess } from "./runs";
import { D1Index } from "@orun/storage";

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  authCtx: RequestContext;
}

export async function handleClaimJob(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "oidc") throw new OrunError("FORBIDDEN", "OIDC required");
  const { runId, jobId } = rc.params;
  const namespaceId = rc.authCtx.namespace.namespaceId;

  let body: Record<string, unknown>;
  try {
    body = await rc.request.json() as Record<string, unknown>;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const runnerId = body.runnerId as string | undefined;
  if (!runnerId || typeof runnerId !== "string") {
    throw new OrunError("INVALID_REQUEST", "Missing runnerId");
  }

  const stub = getCoordinator(rc.env, namespaceId, runId);
  const resp = await coordinatorFetch(stub, `/jobs/${encodeURIComponent(jobId)}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runnerId }),
  });

  const data = await resp.json();
  return json(data, resp.status);
}

export async function handleUpdateJob(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "oidc") throw new OrunError("FORBIDDEN", "OIDC required");
  const { runId, jobId } = rc.params;
  const namespaceId = rc.authCtx.namespace.namespaceId;

  let body: Record<string, unknown>;
  try {
    body = await rc.request.json() as Record<string, unknown>;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const runnerId = body.runnerId as string | undefined;
  const status = body.status as string | undefined;
  if (!runnerId || typeof runnerId !== "string") {
    throw new OrunError("INVALID_REQUEST", "Missing runnerId");
  }
  if (status !== "success" && status !== "failed") {
    throw new OrunError("INVALID_REQUEST", "status must be 'success' or 'failed'");
  }

  const updateBody: CoordinatorUpdateJobRequest = { runnerId, status, error: body.error as string | undefined };

  const stub = getCoordinator(rc.env, namespaceId, runId);
  const resp = await coordinatorFetch(stub, `/jobs/${encodeURIComponent(jobId)}/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updateBody),
  });

  const data = await resp.json();
  if (!resp.ok) {
    return json(data, resp.status);
  }

  rc.ctx.waitUntil((async () => {
    const stateResp = await coordinatorFetch(stub, "/state");
    if (!stateResp.ok) return;
    const state = await stateResp.json() as RunState;

    const db = new D1Index(rc.env.DB);
    const jobs = Object.values(state.jobs);
    const jobDone = jobs.filter((j) => j.status === "success").length;
    const jobFailed = jobs.filter((j) => j.status === "failed").length;
    const finishedAt = (state.status === "completed" || state.status === "failed") ? state.updatedAt : null;

    await db.updateRun(namespaceId, runId, {
      status: state.status === "cancelled" ? "cancelled" : state.status,
      jobDone,
      jobFailed,
      finishedAt,
      updatedAt: state.updatedAt,
    });

    const jobState = state.jobs[jobId];
    if (jobState) {
      const existingRow = await rc.env.DB
        .prepare("SELECT log_ref FROM jobs WHERE namespace_id = ?1 AND run_id = ?2 AND job_id = ?3")
        .bind(namespaceId, runId, jobId)
        .first<{ log_ref: string | null }>();
      await db.upsertJob({
        jobId,
        runId,
        namespaceId,
        component: jobState.component,
        status: jobState.status,
        runnerId: jobState.runnerId,
        startedAt: jobState.startedAt,
        finishedAt: jobState.finishedAt,
        logRef: existingRow?.log_ref ?? null,
      });
    }
  })());

  return json(data, 200);
}

export async function handleHeartbeat(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "oidc") throw new OrunError("FORBIDDEN", "OIDC required");
  const { runId, jobId } = rc.params;
  const namespaceId = rc.authCtx.namespace.namespaceId;

  let body: Record<string, unknown>;
  try {
    body = await rc.request.json() as Record<string, unknown>;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const runnerId = body.runnerId as string | undefined;
  if (!runnerId || typeof runnerId !== "string") {
    throw new OrunError("INVALID_REQUEST", "Missing runnerId");
  }

  const stub = getCoordinator(rc.env, namespaceId, runId);
  const resp = await coordinatorFetch(stub, `/jobs/${encodeURIComponent(jobId)}/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runnerId }),
  });

  const data = await resp.json();
  return json(data, resp.status);
}

export async function handleRunnable(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "oidc") throw new OrunError("FORBIDDEN", "OIDC required");
  const { runId } = rc.params;
  const namespaceId = rc.authCtx.namespace.namespaceId;

  const stub = getCoordinator(rc.env, namespaceId, runId);
  const resp = await coordinatorFetch(stub, "/runnable");
  const data = await resp.json();
  return json(data, resp.status);
}

export async function handleListJobs(rc: RouteContext): Promise<Response> {
  const { runId } = rc.params;

  if (rc.authCtx.type === "oidc") {
    const namespaceId = rc.authCtx.namespace.namespaceId;
    const stub = getCoordinator(rc.env, namespaceId, runId);
    const stateResp = await coordinatorFetch(stub, "/state");
    if (stateResp.ok) {
      const state = await stateResp.json() as RunState;
      const jobs = Object.values(state.jobs).map(coordinatorJobToPublic);
      return json({ jobs });
    }
    const db = new D1Index(rc.env.DB);
    const jobs = await db.listJobs(namespaceId, runId);
    return json({ jobs });
  }

  if (rc.authCtx.type === "session") {
    const db = new D1Index(rc.env.DB);
    for (const nsId of rc.authCtx.allowedNamespaceIds) {
      const run = await db.getRun(nsId, runId);
      if (run) {
        const jobs = await db.listJobs(nsId, runId);
        return json({ jobs });
      }
    }
    throw new OrunError("NOT_FOUND", "Run not found");
  }

  throw new OrunError("FORBIDDEN", "Access denied");
}

export async function handleJobStatus(rc: RouteContext): Promise<Response> {
  const { runId, jobId } = rc.params;

  if (rc.authCtx.type === "oidc") {
    const namespaceId = rc.authCtx.namespace.namespaceId;
    const stub = getCoordinator(rc.env, namespaceId, runId);
    const resp = await coordinatorFetch(stub, `/jobs/${encodeURIComponent(jobId)}/status`);
    if (resp.ok) {
      const data = await resp.json();
      return json(data);
    }
    throw new OrunError("NOT_FOUND", "Job not found");
  }

  if (rc.authCtx.type === "session") {
    const db = new D1Index(rc.env.DB);
    for (const nsId of rc.authCtx.allowedNamespaceIds) {
      const run = await db.getRun(nsId, runId);
      if (run) {
        const jobs = await db.listJobs(nsId, runId);
        const job = jobs.find((j) => j.jobId === jobId);
        if (job) return json(job);
        throw new OrunError("NOT_FOUND", "Job not found");
      }
    }
    throw new OrunError("NOT_FOUND", "Run not found");
  }

  throw new OrunError("FORBIDDEN", "Access denied");
}

function coordinatorJobToPublic(j: RunState["jobs"][string]): Partial<Job> {
  return {
    jobId: j.jobId,
    component: j.component,
    status: j.status,
    deps: j.deps,
    runnerId: j.runnerId,
    startedAt: j.startedAt,
    finishedAt: j.finishedAt,
    lastError: j.lastError,
    heartbeatAt: j.heartbeatAt,
    logRef: null,
  };
}
