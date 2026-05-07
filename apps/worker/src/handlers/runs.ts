import type { Env, Run, Plan } from "@orun/types";
import type { RequestContext } from "../auth";
import type { RunState } from "@orun/coordinator";
import { OrunError } from "../auth/errors";
import { json } from "../http";
import { getCoordinator, coordinatorFetch } from "../coordinator";
import { D1Index } from "@orun/storage";
import { R2Storage } from "@orun/storage";
import { resolveSessionNamespaceIds, getOrCreateAccount, lookupRepoInAccountCache, lookupRepoInAccountCacheByRepoId } from "./accounts";

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  authCtx: RequestContext;
}

export function assertNamespaceAccess(authCtx: RequestContext, namespaceId: string): void {
  if (authCtx.type === "oidc") {
    if (authCtx.namespace.namespaceId !== namespaceId) {
      throw new OrunError("FORBIDDEN", "Namespace access denied");
    }
    return;
  }
  if (authCtx.type === "session") {
    if (!authCtx.allowedNamespaceIds.includes(namespaceId)) {
      throw new OrunError("FORBIDDEN", "Namespace access denied");
    }
    return;
  }
  throw new OrunError("FORBIDDEN", "Deploy token not accepted");
}

// Return the local namespace prefix for a CLI session. Throws if the session
// lacks githubUserId (requires re-login).
function requireLocalNamespacePrefix(authCtx: RequestContext & { type: "session" }): string {
  const githubUserId = authCtx.githubUserId;
  if (!githubUserId) {
    throw new OrunError(
      "FORBIDDEN",
      "CLI session is missing GitHub user ID. Re-run `orun auth login` to obtain a refreshed token.",
    );
  }
  return `local:user:${githubUserId}:repo:`;
}

export async function handleCreateRun(rc: RouteContext): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await rc.request.json() as Record<string, unknown>;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  const plan = body.plan as Plan | undefined;
  if (!plan || !plan.checksum || !Array.isArray(plan.jobs)) {
    throw new OrunError("INVALID_REQUEST", "Missing or invalid plan");
  }

  let runId = body.runId as string | undefined;
  if (runId !== undefined) {
    if (typeof runId !== "string" || runId.length === 0) {
      throw new OrunError("INVALID_REQUEST", "runId must be a non-empty string");
    }
  } else {
    runId = crypto.randomUUID();
  }

  let namespaceId: string;
  let namespaceSlug: string;

  if (rc.authCtx.type === "oidc") {
    namespaceId = rc.authCtx.namespace.namespaceId;
    namespaceSlug = rc.authCtx.namespace.namespaceSlug;
    if (body.namespaceId && body.namespaceId !== namespaceId) {
      throw new OrunError("FORBIDDEN", "Namespace mismatch");
    }
  } else if (rc.authCtx.type === "session") {
    if (rc.authCtx.sessionKind !== "cli") {
      throw new OrunError("FORBIDDEN", "Dashboard sessions may not create runs");
    }

    const localPrefix = requireLocalNamespacePrefix(rc.authCtx);
    const githubUserId = rc.authCtx.githubUserId!;
    const repoFullName = body.repoFullName as string | undefined;
    const bodyNs = body.namespaceId as string | undefined;

    if (bodyNs && !bodyNs.startsWith("local:")) {
      throw new OrunError(
        "FORBIDDEN",
        "Session tokens may not create runs under canonical repo namespaces. Use an OIDC token for CI/workload runs.",
      );
    }

    const account = await getOrCreateAccount(rc.env.DB, rc.authCtx.actor);

    if (repoFullName) {
      // Resolve namespace from account-scoped repo cache using repoFullName.
      const cached = await lookupRepoInAccountCache(rc.env.DB, account.account_id, repoFullName);
      if (!cached) {
        throw new OrunError(
          "NOT_FOUND",
          `Repository ${repoFullName} is not in your repo cache. Re-run \`orun auth login\` to refresh.`,
        );
      }
      namespaceId = `${localPrefix}${cached.repo_id}`;
      namespaceSlug = `local:${rc.authCtx.actor}/${repoFullName}`;
      if (bodyNs && bodyNs !== namespaceId) {
        throw new OrunError("FORBIDDEN", "Namespace mismatch");
      }
    } else if (bodyNs) {
      // Client provided a local namespaceId — verify it matches session identity.
      if (!bodyNs.startsWith(localPrefix)) {
        throw new OrunError(
          "FORBIDDEN",
          "Namespace does not belong to this CLI session. Re-run `orun auth login` and `orun cloud link`.",
        );
      }
      const repoId = bodyNs.slice(localPrefix.length);
      const cached = await lookupRepoInAccountCacheByRepoId(rc.env.DB, account.account_id, repoId);
      if (!cached) {
        throw new OrunError(
          "NOT_FOUND",
          "Local namespace not found in your repo cache. Re-run `orun auth login`.",
        );
      }
      namespaceId = bodyNs;
      namespaceSlug = `local:${rc.authCtx.actor}/${cached.repo_full_name}`;
    } else {
      throw new OrunError(
        "INVALID_REQUEST",
        "CLI session requires repoFullName or a local namespaceId (local:user:...) to create a run.",
      );
    }
  } else {
    throw new OrunError("FORBIDDEN", "Deploy token not accepted");
  }

  const stub = getCoordinator(rc.env, namespaceId, runId);
  const initResp = await coordinatorFetch(stub, "/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, runId, namespaceId, namespaceSlug }),
  });

  const initData = await initResp.json() as { ok?: boolean; alreadyExists?: boolean; error?: string; code?: string };

  if (!initResp.ok) {
    if (initResp.status === 409) {
      throw new OrunError("CONFLICT", initData.error ?? "Run already exists with different state");
    }
    throw new OrunError("INTERNAL_ERROR", initData.error ?? "Coordinator init failed");
  }

  if (initData.alreadyExists) {
    const stateResp = await coordinatorFetch(stub, "/state");
    if (stateResp.ok) {
      const state = await stateResp.json() as RunState;
      if (state.plan.checksum !== plan.checksum) {
        throw new OrunError("CONFLICT", "Run exists with different plan checksum");
      }
    } else {
      throw new OrunError("INTERNAL_ERROR", "Cannot verify existing run state");
    }
    return json({ runId, status: "running", createdAt: new Date().toISOString() }, 200);
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const triggerType = (body.triggerType as Run["triggerType"]) ?? "ci";
  const actor = (body.actor as string) ?? rc.authCtx.actor;
  const dryRun = Boolean(body.dryRun);

  const db = new D1Index(rc.env.DB);
  const r2 = new R2Storage(rc.env.STORAGE);

  const mirrorPromise = (async () => {
    await db.createRun({
      runId,
      namespace: { namespaceId, namespaceSlug },
      status: "running",
      planChecksum: plan.checksum,
      triggerType,
      actor,
      createdAt: now,
      updatedAt: now,
      finishedAt: null,
      jobTotal: plan.jobs.length,
      jobDone: 0,
      jobFailed: 0,
      dryRun,
      expiresAt,
    });

    for (const pj of plan.jobs) {
      await db.upsertJob({
        jobId: pj.jobId,
        runId,
        namespaceId,
        component: pj.component,
        status: "pending",
        runnerId: null,
        startedAt: null,
        finishedAt: null,
        logRef: null,
      });
    }

    await r2.savePlan(namespaceId, plan);
  })();

  rc.ctx.waitUntil(mirrorPromise);

  return json({ runId, status: "running", createdAt: now }, 201);
}

export async function handleListRuns(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const url = new URL(rc.request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") ?? "0", 10) || 0, 0);

  const resolved = await resolveSessionNamespaceIds(rc.authCtx, rc.env.DB);
  const db = new D1Index(rc.env.DB);
  const runs = await db.listRuns(resolved, limit, offset);
  return json({ runs });
}

export async function handleGetRun(rc: RouteContext): Promise<Response> {
  const { runId } = rc.params;

  if (rc.authCtx.type === "oidc") {
    const namespaceId = rc.authCtx.namespace.namespaceId;
    const stub = getCoordinator(rc.env, namespaceId, runId);
    const stateResp = await coordinatorFetch(stub, "/state");
    if (stateResp.ok) {
      const state = await stateResp.json() as RunState;
      return json({ run: coordinatorStateToRun(state) });
    }
    const db = new D1Index(rc.env.DB);
    const run = await db.getRun(namespaceId, runId);
    if (run) return json({ run });
    throw new OrunError("NOT_FOUND", "Run not found");
  }

  if (rc.authCtx.type === "session") {
    const resolved = await resolveSessionNamespaceIds(rc.authCtx, rc.env.DB);
    const db = new D1Index(rc.env.DB);
    for (const nsId of resolved) {
      const run = await db.getRun(nsId, runId);
      if (run) return json({ run });
    }
    throw new OrunError("NOT_FOUND", "Run not found");
  }

  throw new OrunError("FORBIDDEN", "Access denied");
}

function coordinatorStateToRun(state: RunState): Partial<Run> {
  const jobs = Object.values(state.jobs);
  return {
    runId: state.runId,
    namespace: { namespaceId: state.namespaceId, namespaceSlug: "" },
    status: state.status === "cancelled" ? "cancelled" : state.status,
    planChecksum: state.plan.checksum,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    jobTotal: jobs.length,
    jobDone: jobs.filter((j) => j.status === "success").length,
    jobFailed: jobs.filter((j) => j.status === "failed").length,
  };
}
