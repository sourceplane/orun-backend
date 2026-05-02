import type { Env } from "@orun/types";
import type { RequestContext } from "../auth";
import { OrunError } from "../auth/errors";
import { json, corsHeaders } from "../http";
import { assertNamespaceAccess } from "./runs";
import { R2Storage } from "@orun/storage";
import { D1Index } from "@orun/storage";

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  authCtx: RequestContext;
}

export async function handleUploadLog(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "oidc") throw new OrunError("FORBIDDEN", "OIDC required");
  const { runId, jobId } = rc.params;
  const namespaceId = rc.authCtx.namespace.namespaceId;

  const content = rc.request.body ?? "";
  const r2 = new R2Storage(rc.env.STORAGE);

  const db = new D1Index(rc.env.DB);
  const run = await db.getRun(namespaceId, runId);
  const expiresAt = run?.expiresAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const logRef = await r2.writeLog(namespaceId, runId, jobId, content, { expiresAt });

  rc.ctx.waitUntil((async () => {
    const updated = await rc.env.DB
      .prepare("UPDATE jobs SET log_ref = ?1 WHERE namespace_id = ?2 AND run_id = ?3 AND job_id = ?4")
      .bind(logRef, namespaceId, runId, jobId)
      .run();
    if ((updated.meta?.changes ?? 0) === 0) {
      await db.upsertJob({
        jobId,
        runId,
        namespaceId,
        component: "",
        status: "pending",
        runnerId: null,
        startedAt: null,
        finishedAt: null,
        logRef,
      });
    }
  })());

  return json({ ok: true, logRef });
}

export async function handleGetLog(rc: RouteContext): Promise<Response> {
  const { runId, jobId } = rc.params;
  let namespaceId: string;

  if (rc.authCtx.type === "oidc") {
    namespaceId = rc.authCtx.namespace.namespaceId;
  } else if (rc.authCtx.type === "session") {
    const db = new D1Index(rc.env.DB);
    let found = false;
    namespaceId = "";
    for (const nsId of rc.authCtx.allowedNamespaceIds) {
      const run = await db.getRun(nsId, runId);
      if (run) {
        namespaceId = nsId;
        found = true;
        break;
      }
    }
    if (!found) throw new OrunError("NOT_FOUND", "Run not found");
  } else {
    throw new OrunError("FORBIDDEN", "Access denied");
  }

  const r2 = new R2Storage(rc.env.STORAGE);
  const obj = await r2.readLog(namespaceId, runId, jobId);

  if (!obj) {
    throw new OrunError("NOT_FOUND", "Log not found");
  }

  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      ...corsHeaders(),
    },
  });
}
