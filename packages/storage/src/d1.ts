import type {
  Run, Job, Namespace, RunStatus, JobStatus, CliSession, CreateCliSessionInput,
  CatalogSyncAccepted, CatalogComponentSummary, CatalogComponentDetail,
  CatalogComponentEvent, CatalogComponentListResponse, CatalogComponentRelationsResponse,
  CatalogEnvironmentState, CatalogComponentRelation, CatalogComponentStatus,
  CatalogRelationType, CatalogRelationTargetKind,
} from "@orun/types";

export type IndexedJobInput = Pick<
  Job,
  "jobId" | "runId" | "component" | "status" | "runnerId" | "startedAt" | "finishedAt" | "logRef"
> & {
  namespaceId: string;
};

export interface CatalogUploadInput {
  uploadId: string;
  namespaceId: string;
  repoId: string;
  repoFullName: string;
  commitSha: string;
  branch?: string;
  workflowRunId?: string;
  workflowRef?: string;
  prNumber?: number;
  envelopeRef: string;
  componentCount: number;
  createdAt: string;
}

export interface CatalogComponentUpsert {
  componentId: string;
  namespaceId: string;
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

export interface CatalogRelationInput {
  relationId: string;
  sourceComponentId: string;
  relationType: CatalogRelationType;
  targetKind: CatalogRelationTargetKind;
  targetRef: string;
  environment?: string;
  jobId?: string;
  lastSeenAt: string;
}

export interface CatalogEventInput {
  eventId: string;
  componentId: string;
  namespaceId: string;
  uploadId: string;
  eventType: CatalogComponentEvent["eventType"];
  commitSha: string;
  prNumber?: number;
  summary?: string;
  payloadRef?: string;
  createdAt: string;
}

export interface CatalogComponentFilter {
  visibleNamespaceIds: string[];
  q?: string;
  repoId?: string;
  type?: string;
  owner?: string;
  system?: string;
  tag?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

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
        `DELETE FROM jobs WHERE EXISTS (
           SELECT 1 FROM runs
           WHERE runs.namespace_id = jobs.namespace_id
             AND runs.run_id = jobs.run_id
             AND runs.expires_at <= ?1
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

  async createCliSession(input: CreateCliSessionInput): Promise<CliSession> {
    const now = new Date().toISOString();
    await this.db
      .prepare(
        `INSERT INTO cli_sessions (session_id, account_id, github_login, refresh_token_hash, allowed_namespace_ids_json, created_at, expires_at, user_agent, device_label)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(
        input.sessionId,
        input.accountId,
        input.githubLogin,
        input.refreshTokenHash,
        JSON.stringify(input.allowedNamespaceIds),
        now,
        input.expiresAt,
        input.userAgent ?? null,
        input.deviceLabel ?? null,
      )
      .run();
    return {
      sessionId: input.sessionId,
      accountId: input.accountId,
      githubLogin: input.githubLogin,
      allowedNamespaceIds: input.allowedNamespaceIds,
      createdAt: now,
      lastUsedAt: null,
      expiresAt: input.expiresAt,
      revokedAt: null,
      userAgent: input.userAgent ?? null,
      deviceLabel: input.deviceLabel ?? null,
    };
  }

  async getCliSessionByRefreshHash(refreshTokenHash: string): Promise<CliSession | null> {
    const row = await this.db
      .prepare(
        `SELECT session_id, account_id, github_login, allowed_namespace_ids_json, created_at, last_used_at, expires_at, revoked_at, user_agent, device_label
         FROM cli_sessions WHERE refresh_token_hash = ?1`,
      )
      .bind(refreshTokenHash)
      .first<Record<string, unknown>>();
    if (!row) return null;
    return rowToCliSession(row);
  }

  async markCliSessionUsed(sessionId: string, usedAt: string): Promise<void> {
    await this.db
      .prepare(`UPDATE cli_sessions SET last_used_at = ?1 WHERE session_id = ?2`)
      .bind(usedAt, sessionId)
      .run();
  }

  async revokeCliSession(sessionId: string, revokedAt: string): Promise<void> {
    await this.db
      .prepare(`UPDATE cli_sessions SET revoked_at = ?1 WHERE session_id = ?2`)
      .bind(revokedAt, sessionId)
      .run();
  }

  async recordCatalogUpload(input: CatalogUploadInput): Promise<CatalogSyncAccepted> {
    const existing = await this.db
      .prepare(`SELECT upload_id, created_at, component_count FROM catalog_uploads WHERE upload_id = ?1`)
      .bind(input.uploadId)
      .first<{ upload_id: string; created_at: string; component_count: number }>();

    if (existing) {
      return {
        uploadId: existing.upload_id,
        acceptedAt: existing.created_at,
        componentCount: existing.component_count,
      };
    }

    await this.db
      .prepare(
        `INSERT INTO catalog_uploads (upload_id, namespace_id, repo_id, repo_full_name, commit_sha, branch, workflow_run_id, workflow_ref, pr_number, envelope_ref, component_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
      )
      .bind(
        input.uploadId, input.namespaceId, input.repoId, input.repoFullName,
        input.commitSha, input.branch ?? null, input.workflowRunId ?? null,
        input.workflowRef ?? null, input.prNumber ?? null, input.envelopeRef,
        input.componentCount, input.createdAt
      )
      .run();

    return { uploadId: input.uploadId, acceptedAt: input.createdAt, componentCount: input.componentCount };
  }

  async uploadExists(uploadId: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT upload_id FROM catalog_uploads WHERE upload_id = ?1`)
      .bind(uploadId)
      .first<{ upload_id: string }>();
    return row !== null;
  }

  async upsertCatalogComponent(input: CatalogComponentUpsert): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO catalog_components (component_id, namespace_id, repo_id, repo_full_name, name, title, description, type, owner, system, lifecycle, repo_path, tags_json, environments_json, latest_plan_id, latest_plan_checksum, latest_commit_sha, latest_status, current_state_ref, first_seen_at, last_seen_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)
         ON CONFLICT(component_id) DO UPDATE SET
           name = excluded.name,
           title = excluded.title,
           description = excluded.description,
           type = excluded.type,
           owner = excluded.owner,
           system = excluded.system,
           lifecycle = excluded.lifecycle,
           repo_path = excluded.repo_path,
           tags_json = excluded.tags_json,
           environments_json = excluded.environments_json,
           latest_plan_id = excluded.latest_plan_id,
           latest_plan_checksum = excluded.latest_plan_checksum,
           latest_commit_sha = excluded.latest_commit_sha,
           latest_status = excluded.latest_status,
           current_state_ref = excluded.current_state_ref,
           last_seen_at = excluded.last_seen_at`
      )
      .bind(
        input.componentId, input.namespaceId, input.repoId, input.repoFullName,
        input.name, input.title ?? null, input.description ?? null, input.type,
        input.owner ?? null, input.system ?? null, input.lifecycle ?? null,
        input.repoPath, JSON.stringify(input.tags), JSON.stringify(input.environments),
        input.latestPlanId ?? null, input.latestPlanChecksum ?? null,
        input.latestCommitSha, input.latestStatus, input.currentStateRef,
        input.firstSeenAt, input.lastSeenAt
      )
      .run();
  }

  async getCatalogComponentRow(componentId: string): Promise<Record<string, unknown> | null> {
    return this.db
      .prepare(`SELECT * FROM catalog_components WHERE component_id = ?1`)
      .bind(componentId)
      .first<Record<string, unknown>>();
  }

  async replaceCatalogRelations(componentId: string, relations: CatalogRelationInput[]): Promise<void> {
    await this.db
      .prepare(`DELETE FROM catalog_component_relations WHERE source_component_id = ?1`)
      .bind(componentId)
      .run();

    for (const rel of relations) {
      await this.db
        .prepare(
          `INSERT INTO catalog_component_relations (relation_id, source_component_id, relation_type, target_kind, target_ref, environment, job_id, last_seen_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(relation_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`
        )
        .bind(
          rel.relationId, componentId, rel.relationType, rel.targetKind,
          rel.targetRef, rel.environment ?? null, rel.jobId ?? null, rel.lastSeenAt
        )
        .run();
    }
  }

  async appendCatalogComponentEvent(input: CatalogEventInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO catalog_component_events (event_id, component_id, namespace_id, upload_id, event_type, commit_sha, pr_number, summary, payload_ref, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(event_id) DO NOTHING`
      )
      .bind(
        input.eventId, input.componentId, input.namespaceId, input.uploadId,
        input.eventType, input.commitSha, input.prNumber ?? null,
        input.summary ?? null, input.payloadRef ?? null, input.createdAt
      )
      .run();
  }

  async listCatalogComponents(filter: CatalogComponentFilter): Promise<CatalogComponentListResponse> {
    if (filter.visibleNamespaceIds.length === 0) return { components: [], total: 0 };

    const limit = Math.min(filter.limit ?? 50, 100);
    const offset = filter.offset ?? 0;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const nsPH = filter.visibleNamespaceIds.map(() => `?${idx++}`).join(", ");
    params.push(...filter.visibleNamespaceIds);
    conditions.push(`cc.namespace_id IN (${nsPH})`);

    if (filter.repoId) { conditions.push(`cc.repo_id = ?${idx++}`); params.push(filter.repoId); }
    if (filter.type) { conditions.push(`cc.type = ?${idx++}`); params.push(filter.type); }
    if (filter.owner) { conditions.push(`cc.owner = ?${idx++}`); params.push(filter.owner); }
    if (filter.system) { conditions.push(`cc.system = ?${idx++}`); params.push(filter.system); }
    if (filter.status) { conditions.push(`cc.latest_status = ?${idx++}`); params.push(filter.status); }
    if (filter.tag) { conditions.push(`cc.tags_json LIKE ?${idx++}`); params.push(`%${filter.tag}%`); }
    if (filter.q) {
      conditions.push(
        `(cc.name LIKE ?${idx} OR cc.title LIKE ?${idx} OR cc.owner LIKE ?${idx} OR cc.system LIKE ?${idx} OR cc.repo_full_name LIKE ?${idx} OR cc.tags_json LIKE ?${idx})`
      );
      params.push(`%${filter.q}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countSql = `SELECT COUNT(*) as total FROM catalog_components cc JOIN namespaces n ON n.namespace_id = cc.namespace_id ${where}`;
    const countRow = await this.db.prepare(countSql).bind(...params).first<{ total: number }>();
    const total = countRow?.total ?? 0;

    const dataSql = `SELECT cc.*, n.namespace_slug FROM catalog_components cc JOIN namespaces n ON n.namespace_id = cc.namespace_id ${where} ORDER BY cc.last_seen_at DESC LIMIT ?${idx++} OFFSET ?${idx}`;
    params.push(limit, offset);

    const result = await this.db.prepare(dataSql).bind(...params).all<Record<string, unknown>>();
    const components = (result.results ?? []).map(rowToCatalogSummary);

    return { components, total };
  }

  async getCatalogComponent(visibleNamespaceIds: string[], componentId: string): Promise<CatalogComponentDetail | null> {
    if (visibleNamespaceIds.length === 0) return null;

    const nsPH = visibleNamespaceIds.map((_, i) => `?${i + 2}`).join(", ");
    const row = await this.db
      .prepare(
        `SELECT cc.*, n.namespace_slug FROM catalog_components cc JOIN namespaces n ON n.namespace_id = cc.namespace_id WHERE cc.component_id = ?1 AND cc.namespace_id IN (${nsPH})`
      )
      .bind(componentId, ...visibleNamespaceIds)
      .first<Record<string, unknown>>();

    if (!row) return null;

    const relResult = await this.db
      .prepare(`SELECT * FROM catalog_component_relations WHERE source_component_id = ?1`)
      .bind(componentId)
      .all<Record<string, unknown>>();

    const relations: CatalogComponentRelation[] = (relResult.results ?? []).map(rowToRelation);
    return { ...rowToCatalogSummary(row), relations };
  }

  async listCatalogComponentEvents(visibleNamespaceIds: string[], componentId: string): Promise<CatalogComponentEvent[]> {
    if (visibleNamespaceIds.length === 0) return [];

    const nsPH = visibleNamespaceIds.map((_, i) => `?${i + 2}`).join(", ");
    const result = await this.db
      .prepare(
        `SELECT e.*, n.namespace_slug FROM catalog_component_events e JOIN namespaces n ON n.namespace_id = e.namespace_id WHERE e.component_id = ?1 AND e.namespace_id IN (${nsPH}) ORDER BY e.created_at DESC LIMIT 100`
      )
      .bind(componentId, ...visibleNamespaceIds)
      .all<Record<string, unknown>>();

    return (result.results ?? []).map(rowToCatalogEvent);
  }

  async listCatalogComponentRelations(visibleNamespaceIds: string[], componentId: string): Promise<CatalogComponentRelationsResponse> {
    if (visibleNamespaceIds.length === 0) return { outgoing: [], incoming: [] };

    const nsPH = visibleNamespaceIds.map((_, i) => `?${i + 2}`).join(", ");

    const outResult = await this.db
      .prepare(
        `SELECT r.* FROM catalog_component_relations r JOIN catalog_components cc ON cc.component_id = r.source_component_id WHERE r.source_component_id = ?1 AND cc.namespace_id IN (${nsPH})`
      )
      .bind(componentId, ...visibleNamespaceIds)
      .all<Record<string, unknown>>();

    const inResult = await this.db
      .prepare(
        `SELECT r.*, cc.name as source_name FROM catalog_component_relations r JOIN catalog_components cc ON cc.component_id = r.source_component_id WHERE r.target_ref = (SELECT component_id FROM catalog_components WHERE component_id = ?1) AND cc.namespace_id IN (${nsPH})`
      )
      .bind(componentId, ...visibleNamespaceIds)
      .all<Record<string, unknown>>();

    const outgoing = (outResult.results ?? []).map(rowToRelation);
    const incoming = (inResult.results ?? []).map((row) => ({
      ...rowToRelation(row),
      sourceComponentId: row.source_component_id as string,
      sourceName: row.source_name as string,
    }));

    return { outgoing, incoming };
  }

  async listCatalogComponentRecentRuns(visibleNamespaceIds: string[], componentName: string, limit = 10): Promise<Run[]> {
    if (visibleNamespaceIds.length === 0) return [];

    const nsPH = visibleNamespaceIds.map((_, i) => `?${i + 2}`).join(", ");
    const result = await this.db
      .prepare(
        `SELECT r.*, n.namespace_slug FROM runs r JOIN namespaces n ON n.namespace_id = r.namespace_id WHERE r.namespace_id IN (${nsPH}) AND EXISTS (SELECT 1 FROM jobs j WHERE j.run_id = r.run_id AND j.namespace_id = r.namespace_id AND j.component = ?1) ORDER BY r.created_at DESC LIMIT ?${visibleNamespaceIds.length + 2}`
      )
      .bind(componentName, ...visibleNamespaceIds, limit)
      .all<Record<string, unknown>>();

    return (result.results ?? []).map(rowToRun);
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

function rowToCliSession(row: Record<string, unknown>): CliSession {
  return {
    sessionId: row.session_id as string,
    accountId: row.account_id as string,
    githubLogin: row.github_login as string,
    allowedNamespaceIds: JSON.parse(row.allowed_namespace_ids_json as string) as string[],
    createdAt: row.created_at as string,
    lastUsedAt: (row.last_used_at as string) ?? null,
    expiresAt: row.expires_at as string,
    revokedAt: (row.revoked_at as string) ?? null,
    userAgent: (row.user_agent as string) ?? null,
    deviceLabel: (row.device_label as string) ?? null,
  };
}

function rowToCatalogSummary(row: Record<string, unknown>): CatalogComponentSummary {
  return {
    componentId: row.component_id as string,
    namespace: {
      namespaceId: row.namespace_id as string,
      namespaceSlug: (row.namespace_slug as string) ?? "",
    },
    repoId: row.repo_id as string,
    repoFullName: row.repo_full_name as string,
    name: row.name as string,
    title: (row.title as string) ?? undefined,
    description: (row.description as string) ?? undefined,
    type: row.type as string,
    owner: (row.owner as string) ?? undefined,
    system: (row.system as string) ?? undefined,
    lifecycle: (row.lifecycle as string) ?? undefined,
    repoPath: row.repo_path as string,
    tags: JSON.parse((row.tags_json as string) ?? "[]") as string[],
    environments: JSON.parse((row.environments_json as string) ?? "[]") as CatalogEnvironmentState[],
    latestPlanId: (row.latest_plan_id as string) ?? undefined,
    latestPlanChecksum: (row.latest_plan_checksum as string) ?? undefined,
    latestCommitSha: row.latest_commit_sha as string,
    latestStatus: (row.latest_status as CatalogComponentStatus) ?? "unknown",
    currentStateRef: row.current_state_ref as string,
    firstSeenAt: row.first_seen_at as string,
    lastSeenAt: row.last_seen_at as string,
  };
}

function rowToRelation(row: Record<string, unknown>): CatalogComponentRelation {
  return {
    relationType: row.relation_type as CatalogRelationType,
    targetKind: row.target_kind as CatalogRelationTargetKind,
    targetRef: row.target_ref as string,
    environment: (row.environment as string) ?? undefined,
    jobId: (row.job_id as string) ?? undefined,
  };
}

function rowToCatalogEvent(row: Record<string, unknown>): CatalogComponentEvent {
  return {
    eventId: row.event_id as string,
    componentId: row.component_id as string,
    namespace: {
      namespaceId: row.namespace_id as string,
      namespaceSlug: (row.namespace_slug as string) ?? "",
    },
    uploadId: row.upload_id as string,
    eventType: row.event_type as CatalogComponentEvent["eventType"],
    commitSha: row.commit_sha as string,
    prNumber: (row.pr_number as number) ?? undefined,
    summary: (row.summary as string) ?? undefined,
    payloadRef: (row.payload_ref as string) ?? undefined,
    createdAt: row.created_at as string,
  };
}
