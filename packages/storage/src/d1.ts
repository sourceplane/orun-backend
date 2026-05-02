import type { Run, Job, Namespace, RunStatus, JobStatus } from "@orun/types";

export type IndexedJobInput = Pick<
  Job,
  "jobId" | "runId" | "component" | "status" | "runnerId" | "startedAt" | "finishedAt" | "logRef"
> & {
  namespaceId: string;
};

export class D1Index {
  constructor(private db: D1Database) {}

  async upsertNamespace(namespace: Namespace): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO namespaces (namespace_id, namespace_slug, last_seen_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(namespace_id) DO UPDATE SET
           namespace_slug = excluded.namespace_slug,
           last_seen_at = excluded.last_seen_at`
      )
      .bind(namespace.namespaceId, namespace.namespaceSlug, new Date().toISOString())
      .run();
  }

  async createRun(run: Run): Promise<void> {
    await this.upsertNamespace(run.namespace);
    await this.db
      .prepare(
        `INSERT INTO runs (run_id, namespace_id, status, plan_checksum, trigger_type, actor, dry_run, created_at, updated_at, finished_at, job_total, job_done, job_failed, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(namespace_id, run_id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at`
      )
      .bind(
        run.runId,
        run.namespace.namespaceId,
        run.status,
        run.planChecksum,
        run.triggerType,
        run.actor,
        run.dryRun ? 1 : 0,
        run.createdAt,
        run.updatedAt,
        run.finishedAt,
        run.jobTotal,
        run.jobDone,
        run.jobFailed,
        run.expiresAt
      )
      .run();
  }

  async updateRun(
    namespaceId: string,
    runId: string,
    update: Partial<Pick<Run, "status" | "jobDone" | "jobFailed" | "finishedAt" | "updatedAt">>
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (update.status !== undefined) {
      setClauses.push(`status = ?${paramIdx++}`);
      values.push(update.status);
    }
    if (update.jobDone !== undefined) {
      setClauses.push(`job_done = ?${paramIdx++}`);
      values.push(update.jobDone);
    }
    if (update.jobFailed !== undefined) {
      setClauses.push(`job_failed = ?${paramIdx++}`);
      values.push(update.jobFailed);
    }
    if (update.finishedAt !== undefined) {
      setClauses.push(`finished_at = ?${paramIdx++}`);
      values.push(update.finishedAt);
    }
    if (update.updatedAt !== undefined) {
      setClauses.push(`updated_at = ?${paramIdx++}`);
      values.push(update.updatedAt);
    }

    if (setClauses.length === 0) return;

    const sql = `UPDATE runs SET ${setClauses.join(", ")} WHERE namespace_id = ?${paramIdx++} AND run_id = ?${paramIdx}`;
    values.push(namespaceId, runId);

    await this.db.prepare(sql).bind(...values).run();
  }

  async listRuns(
    namespaceIds: string[],
    limit = 50,
    offset = 0
  ): Promise<Run[]> {
    if (namespaceIds.length === 0) return [];

    const placeholders = namespaceIds.map((_, i) => `?${i + 1}`).join(", ");
    const sql = `SELECT r.*, n.namespace_slug
      FROM runs r
      JOIN namespaces n ON n.namespace_id = r.namespace_id
      WHERE r.namespace_id IN (${placeholders})
      ORDER BY r.created_at DESC
      LIMIT ?${namespaceIds.length + 1} OFFSET ?${namespaceIds.length + 2}`;

    const result = await this.db
      .prepare(sql)
      .bind(...namespaceIds, limit, offset)
      .all();

    return (result.results ?? []).map(rowToRun);
  }

  async getRun(namespaceId: string, runId: string): Promise<Run | null> {
    const result = await this.db
      .prepare(
        `SELECT r.*, n.namespace_slug
         FROM runs r
         JOIN namespaces n ON n.namespace_id = r.namespace_id
         WHERE r.namespace_id = ?1 AND r.run_id = ?2`
      )
      .bind(namespaceId, runId)
      .first();

    if (!result) return null;
    return rowToRun(result);
  }

  async upsertJob(job: IndexedJobInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO jobs (job_id, run_id, namespace_id, component, status, runner_id, started_at, finished_at, log_ref)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(namespace_id, run_id, job_id) DO UPDATE SET
           status = excluded.status,
           runner_id = excluded.runner_id,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           log_ref = excluded.log_ref`
      )
      .bind(
        job.jobId,
        job.runId,
        job.namespaceId,
        job.component,
        job.status,
        job.runnerId,
        job.startedAt,
        job.finishedAt,
        job.logRef
      )
      .run();
  }

  async listJobs(namespaceId: string, runId: string): Promise<Job[]> {
    const result = await this.db
      .prepare(
        `SELECT * FROM jobs WHERE namespace_id = ?1 AND run_id = ?2`
      )
      .bind(namespaceId, runId)
      .all();

    return (result.results ?? []).map(rowToJob);
  }

  async deleteExpiredRuns(now?: string | Date): Promise<number> {
    const isoNow =
      now instanceof Date
        ? now.toISOString()
        : now ?? new Date().toISOString();

    await this.db
      .prepare(
        `DELETE FROM jobs WHERE namespace_id IN (
           SELECT namespace_id FROM runs WHERE expires_at <= ?1
         ) AND run_id IN (
           SELECT run_id FROM runs WHERE expires_at <= ?1
         )`
      )
      .bind(isoNow)
      .run();

    const result = await this.db
      .prepare(`DELETE FROM runs WHERE expires_at <= ?1`)
      .bind(isoNow)
      .run();

    return result.meta?.changes ?? 0;
  }
}

function rowToRun(row: Record<string, unknown>): Run {
  return {
    runId: row.run_id as string,
    namespace: {
      namespaceId: row.namespace_id as string,
      namespaceSlug: (row.namespace_slug as string) ?? "",
    },
    status: row.status as RunStatus,
    planChecksum: (row.plan_checksum as string) ?? "",
    triggerType: (row.trigger_type as Run["triggerType"]) ?? "ci",
    actor: (row.actor as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    finishedAt: (row.finished_at as string) ?? null,
    jobTotal: row.job_total as number,
    jobDone: row.job_done as number,
    jobFailed: row.job_failed as number,
    dryRun: (row.dry_run as number) === 1,
    expiresAt: row.expires_at as string,
  };
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    jobId: row.job_id as string,
    runId: row.run_id as string,
    component: row.component as string,
    status: row.status as JobStatus,
    deps: [],
    runnerId: (row.runner_id as string) ?? null,
    startedAt: (row.started_at as string) ?? null,
    finishedAt: (row.finished_at as string) ?? null,
    lastError: null,
    heartbeatAt: null,
    logRef: (row.log_ref as string) ?? null,
  };
}
