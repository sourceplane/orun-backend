import { describe, it, expect, beforeEach } from "vitest";
import { D1Index } from "./d1";
import type { IndexedJobInput } from "./d1";
import type { Run, Namespace } from "@orun/types";
import { readFileSync } from "fs";
import { join } from "path";

class FakeD1PreparedStatement {
  private boundValues: unknown[] = [];

  constructor(
    private sql: string,
    private db: FakeD1Database
  ) {}

  bind(...values: unknown[]): FakeD1PreparedStatement {
    this.boundValues = values;
    return this;
  }

  async run(): Promise<{ meta: { changes: number } }> {
    const changes = this.db.execute(this.sql, this.boundValues);
    return { meta: { changes } };
  }

  async all(): Promise<{ results: Record<string, unknown>[] }> {
    const results = this.db.query(this.sql, this.boundValues);
    return { results };
  }

  async first(): Promise<Record<string, unknown> | null> {
    const results = this.db.query(this.sql, this.boundValues);
    return results[0] ?? null;
  }
}

class FakeD1Database {
  private tables: Map<string, Record<string, unknown>[]> = new Map();
  public executedSql: { sql: string; params: unknown[] }[] = [];

  constructor() {
    this.tables.set("namespaces", []);
    this.tables.set("runs", []);
    this.tables.set("jobs", []);
    this.tables.set("accounts", []);
    this.tables.set("account_repos", []);
  }

  prepare(sql: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement(sql, this);
  }

  execute(sql: string, params: unknown[]): number {
    this.executedSql.push({ sql, params });
    const normalizedSql = sql.replace(/\s+/g, " ").trim().toUpperCase();

    if (normalizedSql.startsWith("INSERT INTO NAMESPACES")) {
      return this.upsertNamespace(params);
    } else if (normalizedSql.startsWith("INSERT INTO RUNS")) {
      return this.upsertRun(params);
    } else if (normalizedSql.startsWith("UPDATE RUNS")) {
      return this.updateRun(sql, params);
    } else if (normalizedSql.startsWith("INSERT INTO JOBS")) {
      return this.upsertJob(params);
    } else if (normalizedSql.startsWith("DELETE FROM JOBS")) {
      return this.deleteExpiredJobs(params);
    } else if (normalizedSql.startsWith("DELETE FROM RUNS")) {
      return this.deleteExpiredRuns(params);
    }
    return 0;
  }

  query(sql: string, params: unknown[]): Record<string, unknown>[] {
    this.executedSql.push({ sql, params });
    const normalizedSql = sql.replace(/\s+/g, " ").trim().toUpperCase();

    if (normalizedSql.includes("FROM RUNS") && normalizedSql.includes("WHERE R.NAMESPACE_ID") && normalizedSql.includes("R.RUN_ID")) {
      return this.getRunQuery(params);
    } else if (normalizedSql.includes("FROM RUNS") && normalizedSql.includes("IN (")) {
      return this.listRunsQuery(sql, params);
    } else if (normalizedSql.includes("FROM JOBS")) {
      return this.listJobsQuery(params);
    }
    return [];
  }

  private upsertNamespace(params: unknown[]): number {
    const [namespaceId, namespaceSlug, lastSeenAt] = params as string[];
    const namespaces = this.tables.get("namespaces")!;
    const existing = namespaces.find((n) => n.namespace_id === namespaceId);
    if (existing) {
      existing.namespace_slug = namespaceSlug;
      existing.last_seen_at = lastSeenAt;
    } else {
      namespaces.push({ namespace_id: namespaceId, namespace_slug: namespaceSlug, last_seen_at: lastSeenAt });
    }
    return 1;
  }

  private upsertRun(params: unknown[]): number {
    const [runId, namespaceId, status, planChecksum, triggerType, actor, dryRun, createdAt, updatedAt, finishedAt, jobTotal, jobDone, jobFailed, expiresAt] = params;
    const runs = this.tables.get("runs")!;
    const existing = runs.find((r) => r.namespace_id === namespaceId && r.run_id === runId);
    if (existing) {
      existing.status = status;
      existing.updated_at = updatedAt;
    } else {
      runs.push({
        run_id: runId, namespace_id: namespaceId, status, plan_checksum: planChecksum,
        trigger_type: triggerType, actor, dry_run: dryRun, created_at: createdAt,
        updated_at: updatedAt, finished_at: finishedAt, job_total: jobTotal,
        job_done: jobDone, job_failed: jobFailed, expires_at: expiresAt,
      });
    }
    return 1;
  }

  private updateRun(sql: string, params: unknown[]): number {
    const runs = this.tables.get("runs")!;
    const namespaceId = params[params.length - 2] as string;
    const runId = params[params.length - 1] as string;
    const row = runs.find((r) => r.namespace_id === namespaceId && r.run_id === runId);
    if (!row) return 0;

    const setClauses = sql.match(/SET (.+) WHERE/i)?.[1] ?? "";
    const fields = setClauses.split(",").map((c) => c.trim().split(/\s*=\s*/)[0]);
    let paramIdx = 0;
    for (const field of fields) {
      if (field === "status") row.status = params[paramIdx];
      else if (field === "job_done") row.job_done = params[paramIdx];
      else if (field === "job_failed") row.job_failed = params[paramIdx];
      else if (field === "finished_at") row.finished_at = params[paramIdx];
      else if (field === "updated_at") row.updated_at = params[paramIdx];
      paramIdx++;
    }
    return 1;
  }

  private upsertJob(params: unknown[]): number {
    const [jobId, runId, namespaceId, component, status, runnerId, startedAt, finishedAt, logRef] = params;
    const jobs = this.tables.get("jobs")!;
    const existing = jobs.find((j) => j.namespace_id === namespaceId && j.run_id === runId && j.job_id === jobId);
    if (existing) {
      existing.status = status;
      existing.runner_id = runnerId;
      existing.started_at = startedAt;
      existing.finished_at = finishedAt;
      existing.log_ref = logRef;
    } else {
      jobs.push({
        job_id: jobId, run_id: runId, namespace_id: namespaceId,
        component, status, runner_id: runnerId, started_at: startedAt,
        finished_at: finishedAt, log_ref: logRef,
      });
    }
    return 1;
  }

  private deleteExpiredJobs(params: unknown[]): number {
    const [isoNow] = params as string[];
    const jobs = this.tables.get("jobs")!;
    const runs = this.tables.get("runs")!;
    const expiredRunKeys = runs
      .filter((r) => (r.expires_at as string) <= isoNow)
      .map((r) => `${r.namespace_id}:${r.run_id}`);

    const before = jobs.length;
    this.tables.set(
      "jobs",
      jobs.filter((j) => !expiredRunKeys.includes(`${j.namespace_id}:${j.run_id}`))
    );
    return before - this.tables.get("jobs")!.length;
  }

  private deleteExpiredRuns(params: unknown[]): number {
    const [isoNow] = params as string[];
    const runs = this.tables.get("runs")!;
    const before = runs.length;
    this.tables.set(
      "runs",
      runs.filter((r) => (r.expires_at as string) > isoNow)
    );
    return before - this.tables.get("runs")!.length;
  }

  private getRunQuery(params: unknown[]): Record<string, unknown>[] {
    const [namespaceId, runId] = params as string[];
    const runs = this.tables.get("runs")!;
    const namespaces = this.tables.get("namespaces")!;
    const row = runs.find((r) => r.namespace_id === namespaceId && r.run_id === runId);
    if (!row) return [];
    const ns = namespaces.find((n) => n.namespace_id === namespaceId);
    return [{ ...row, namespace_slug: ns?.namespace_slug ?? "" }];
  }

  private listRunsQuery(sql: string, params: unknown[]): Record<string, unknown>[] {
    const runs = this.tables.get("runs")!;
    const namespaces = this.tables.get("namespaces")!;

    const placeholderMatch = sql.match(/IN \(([^)]+)\)/i);
    if (!placeholderMatch) return [];
    const placeholderCount = placeholderMatch[1].split(",").length;
    const namespaceIds = params.slice(0, placeholderCount) as string[];
    const limit = params[placeholderCount] as number;
    const offset = params[placeholderCount + 1] as number;

    const filtered = runs
      .filter((r) => namespaceIds.includes(r.namespace_id as string))
      .sort((a, b) => (b.created_at as string).localeCompare(a.created_at as string));

    return filtered.slice(offset, offset + limit).map((r) => {
      const ns = namespaces.find((n) => n.namespace_id === r.namespace_id);
      return { ...r, namespace_slug: ns?.namespace_slug ?? "" };
    });
  }

  private listJobsQuery(params: unknown[]): Record<string, unknown>[] {
    const [namespaceId, runId] = params as string[];
    const jobs = this.tables.get("jobs")!;
    return jobs.filter((j) => j.namespace_id === namespaceId && j.run_id === runId);
  }

  getTable(name: string): Record<string, unknown>[] {
    return this.tables.get(name) ?? [];
  }
}

function makeNamespace(id: string, slug = "org/repo"): Namespace {
  return { namespaceId: id, namespaceSlug: slug };
}

function makeRun(namespaceId: string, runId: string, overrides: Partial<Run> = {}): Run {
  return {
    runId,
    namespace: makeNamespace(namespaceId),
    status: "pending",
    planChecksum: "checksum-1",
    triggerType: "ci",
    actor: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    finishedAt: null,
    jobTotal: 2,
    jobDone: 0,
    jobFailed: 0,
    dryRun: false,
    expiresAt: "2025-01-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("D1Index", () => {
  let db: FakeD1Database;
  let d1: D1Index;

  beforeEach(() => {
    db = new FakeD1Database();
    d1 = new D1Index(db as unknown as D1Database);
  });

  describe("migrations", () => {
    it("migration files exist and contain valid SQL", () => {
      const migration1 = readFileSync(join(__dirname, "../../../migrations/0001_init.sql"), "utf-8");
      const migration2 = readFileSync(join(__dirname, "../../../migrations/0002_namespaces_account.sql"), "utf-8");
      expect(migration1).toContain("CREATE TABLE namespaces");
      expect(migration1).toContain("CREATE TABLE runs");
      expect(migration1).toContain("CREATE TABLE jobs");
      expect(migration2).toContain("CREATE TABLE accounts");
      expect(migration2).toContain("CREATE TABLE account_repos");
    });
  });

  describe("upsertNamespace", () => {
    it("inserts a new namespace", async () => {
      await d1.upsertNamespace(makeNamespace("ns-1", "org/first"));
      const namespaces = db.getTable("namespaces");
      expect(namespaces).toHaveLength(1);
      expect(namespaces[0].namespace_id).toBe("ns-1");
      expect(namespaces[0].namespace_slug).toBe("org/first");
    });

    it("updates slug on existing namespace", async () => {
      await d1.upsertNamespace(makeNamespace("ns-1", "org/first"));
      await d1.upsertNamespace(makeNamespace("ns-1", "org/renamed"));
      const namespaces = db.getTable("namespaces");
      expect(namespaces).toHaveLength(1);
      expect(namespaces[0].namespace_slug).toBe("org/renamed");
    });
  });

  describe("createRun", () => {
    it("creates namespace and run rows", async () => {
      const run = makeRun("ns-1", "run-1");
      await d1.createRun(run);
      expect(db.getTable("namespaces")).toHaveLength(1);
      expect(db.getTable("runs")).toHaveLength(1);
      expect(db.getTable("runs")[0].run_id).toBe("run-1");
      expect(db.getTable("runs")[0].namespace_id).toBe("ns-1");
    });

    it("is idempotent for same run", async () => {
      const run = makeRun("ns-1", "run-1");
      await d1.createRun(run);
      await d1.createRun(run);
      expect(db.getTable("runs")).toHaveLength(1);
    });
  });

  describe("updateRun", () => {
    it("updates only allowed fields", async () => {
      await d1.createRun(makeRun("ns-1", "run-1"));
      await d1.updateRun("ns-1", "run-1", {
        status: "running",
        jobDone: 1,
        updatedAt: "2025-01-01T01:00:00.000Z",
      });
      const run = db.getTable("runs")[0];
      expect(run.status).toBe("running");
      expect(run.job_done).toBe(1);
      expect(run.updated_at).toBe("2025-01-01T01:00:00.000Z");
    });

    it("does nothing with empty update", async () => {
      await d1.createRun(makeRun("ns-1", "run-1"));
      const sqlCountBefore = db.executedSql.length;
      await d1.updateRun("ns-1", "run-1", {});
      expect(db.executedSql.length).toBe(sqlCountBefore);
    });
  });

  describe("listRuns", () => {
    it("returns only requested namespaces", async () => {
      await d1.createRun(makeRun("ns-1", "run-1"));
      await d1.createRun(makeRun("ns-2", "run-2"));
      await d1.createRun(makeRun("ns-3", "run-3"));

      const runs = await d1.listRuns(["ns-1", "ns-2"]);
      expect(runs).toHaveLength(2);
      expect(runs.every((r) => ["ns-1", "ns-2"].includes(r.namespace.namespaceId))).toBe(true);
    });

    it("orders by created_at DESC", async () => {
      await d1.createRun(makeRun("ns-1", "run-old", { createdAt: "2025-01-01T00:00:00.000Z" }));
      await d1.createRun(makeRun("ns-1", "run-new", { createdAt: "2025-01-02T00:00:00.000Z" }));

      const runs = await d1.listRuns(["ns-1"]);
      expect(runs[0].runId).toBe("run-new");
      expect(runs[1].runId).toBe("run-old");
    });

    it("returns empty array for empty namespace list", async () => {
      await d1.createRun(makeRun("ns-1", "run-1"));
      const runs = await d1.listRuns([]);
      expect(runs).toEqual([]);
    });

    it("respects limit and offset", async () => {
      await d1.createRun(makeRun("ns-1", "run-1", { createdAt: "2025-01-01T00:00:00.000Z" }));
      await d1.createRun(makeRun("ns-1", "run-2", { createdAt: "2025-01-02T00:00:00.000Z" }));
      await d1.createRun(makeRun("ns-1", "run-3", { createdAt: "2025-01-03T00:00:00.000Z" }));

      const runs = await d1.listRuns(["ns-1"], 1, 1);
      expect(runs).toHaveLength(1);
      expect(runs[0].runId).toBe("run-2");
    });
  });

  describe("getRun", () => {
    it("returns run for correct namespace", async () => {
      await d1.createRun(makeRun("ns-1", "run-1"));
      const result = await d1.getRun("ns-1", "run-1");
      expect(result).not.toBeNull();
      expect(result!.runId).toBe("run-1");
    });

    it("cannot read across namespaces", async () => {
      await d1.createRun(makeRun("ns-1", "run-1"));
      const result = await d1.getRun("ns-OTHER", "run-1");
      expect(result).toBeNull();
    });

    it("returns null for non-existent run", async () => {
      const result = await d1.getRun("ns-1", "nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("upsertJob", () => {
    it("inserts a new job", async () => {
      const job: IndexedJobInput = {
        jobId: "job-1",
        runId: "run-1",
        namespaceId: "ns-1",
        component: "api",
        status: "pending",
        runnerId: null,
        startedAt: null,
        finishedAt: null,
        logRef: null,
      };
      await d1.upsertJob(job);
      const jobs = db.getTable("jobs");
      expect(jobs).toHaveLength(1);
      expect(jobs[0].job_id).toBe("job-1");
    });

    it("updates existing job", async () => {
      const job: IndexedJobInput = {
        jobId: "job-1",
        runId: "run-1",
        namespaceId: "ns-1",
        component: "api",
        status: "pending",
        runnerId: null,
        startedAt: null,
        finishedAt: null,
        logRef: null,
      };
      await d1.upsertJob(job);
      await d1.upsertJob({ ...job, status: "running", runnerId: "runner-1" });
      const jobs = db.getTable("jobs");
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe("running");
      expect(jobs[0].runner_id).toBe("runner-1");
    });
  });

  describe("listJobs", () => {
    it("returns only jobs for the requested namespace/run", async () => {
      await d1.upsertJob({
        jobId: "job-1", runId: "run-1", namespaceId: "ns-1",
        component: "api", status: "pending", runnerId: null,
        startedAt: null, finishedAt: null, logRef: null,
      });
      await d1.upsertJob({
        jobId: "job-2", runId: "run-1", namespaceId: "ns-OTHER",
        component: "web", status: "pending", runnerId: null,
        startedAt: null, finishedAt: null, logRef: null,
      });

      const jobs = await d1.listJobs("ns-1", "run-1");
      expect(jobs).toHaveLength(1);
      expect(jobs[0].jobId).toBe("job-1");
    });

    it("returns jobs with deps=[], lastError=null, heartbeatAt=null", async () => {
      await d1.upsertJob({
        jobId: "job-1", runId: "run-1", namespaceId: "ns-1",
        component: "api", status: "success", runnerId: "r-1",
        startedAt: "2025-01-01T00:00:00Z", finishedAt: "2025-01-01T01:00:00Z", logRef: "ns-1/runs/run-1/logs/job-1.log",
      });

      const jobs = await d1.listJobs("ns-1", "run-1");
      expect(jobs[0].deps).toEqual([]);
      expect(jobs[0].lastError).toBeNull();
      expect(jobs[0].heartbeatAt).toBeNull();
    });
  });

  describe("deleteExpiredRuns", () => {
    it("deletes expired runs and their jobs", async () => {
      await d1.createRun(makeRun("ns-1", "run-expired", { expiresAt: "2025-01-01T00:00:00.000Z" }));
      await d1.upsertJob({
        jobId: "job-1", runId: "run-expired", namespaceId: "ns-1",
        component: "api", status: "success", runnerId: null,
        startedAt: null, finishedAt: null, logRef: null,
      });

      const deleted = await d1.deleteExpiredRuns("2025-01-02T00:00:00.000Z");
      expect(deleted).toBe(1);
      expect(db.getTable("runs")).toHaveLength(0);
      expect(db.getTable("jobs")).toHaveLength(0);
    });

    it("leaves non-expired runs/jobs intact", async () => {
      await d1.createRun(makeRun("ns-1", "run-active", { expiresAt: "2025-12-31T00:00:00.000Z" }));
      await d1.upsertJob({
        jobId: "job-1", runId: "run-active", namespaceId: "ns-1",
        component: "api", status: "pending", runnerId: null,
        startedAt: null, finishedAt: null, logRef: null,
      });

      const deleted = await d1.deleteExpiredRuns("2025-01-02T00:00:00.000Z");
      expect(deleted).toBe(0);
      expect(db.getTable("runs")).toHaveLength(1);
      expect(db.getTable("jobs")).toHaveLength(1);
    });

    it("does not delete namespaces or account links", async () => {
      await d1.createRun(makeRun("ns-1", "run-expired", { expiresAt: "2025-01-01T00:00:00.000Z" }));
      await d1.deleteExpiredRuns("2025-01-02T00:00:00.000Z");
      expect(db.getTable("namespaces")).toHaveLength(1);
    });

    it("accepts Date object as now parameter", async () => {
      await d1.createRun(makeRun("ns-1", "run-expired", { expiresAt: "2025-01-01T00:00:00.000Z" }));
      const deleted = await d1.deleteExpiredRuns(new Date("2025-01-02T00:00:00.000Z"));
      expect(deleted).toBe(1);
    });
  });

  describe("namespace isolation in SQL", () => {
    it("all namespace-scoped operations include namespace_id in SQL", async () => {
      await d1.createRun(makeRun("ns-1", "run-1"));
      await d1.updateRun("ns-1", "run-1", { status: "running" });
      await d1.getRun("ns-1", "run-1");
      await d1.listRuns(["ns-1"]);
      await d1.upsertJob({
        jobId: "job-1", runId: "run-1", namespaceId: "ns-1",
        component: "api", status: "pending", runnerId: null,
        startedAt: null, finishedAt: null, logRef: null,
      });
      await d1.listJobs("ns-1", "run-1");

      const namespaceScopedOps = db.executedSql.filter(
        (e) =>
          e.sql.toUpperCase().includes("FROM RUNS") ||
          e.sql.toUpperCase().includes("UPDATE RUNS") ||
          e.sql.toUpperCase().includes("FROM JOBS") ||
          e.sql.toUpperCase().includes("INTO JOBS")
      );

      for (const op of namespaceScopedOps) {
        const hasNamespaceFilter =
          op.sql.includes("namespace_id") || op.params.includes("ns-1");
        expect(hasNamespaceFilter).toBe(true);
      }
    });
  });
});
