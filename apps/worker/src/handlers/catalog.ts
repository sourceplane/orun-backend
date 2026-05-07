import type { Env, CatalogSyncEnvelope, CatalogComponentStatus } from "@orun/types";
import type { RequestContext } from "../auth";
import { OrunError } from "../auth/errors";
import { json } from "../http";
import { D1Index } from "@orun/storage";
import { R2Storage } from "@orun/storage";
import type {
  CatalogUploadInput,
  CatalogComponentUpsert,
  CatalogRelationInput,
  CatalogEventInput,
  CatalogComponentFilter,
} from "@orun/storage";
import { getAccountByLogin } from "./accounts";

const SUPPORTED_SCHEMA_VERSION = "1";
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  authCtx: RequestContext;
}

// Compute a deterministic relation_id from the relation's key fields.
async function deriveRelationId(parts: (string | null | undefined)[]): Promise<string> {
  const data = new TextEncoder().encode(parts.map((p) => p ?? "").join("\x1f"));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function validateComponentPath(path: string): void {
  if (!path || path.trim() === "") {
    throw new OrunError("INVALID_REQUEST", `Component path must not be empty`);
  }
  if (path.startsWith("/")) {
    throw new OrunError("INVALID_REQUEST", `Component path must be relative, got: ${path}`);
  }
  const segments = path.split("/");
  if (segments.some((s) => s === "..")) {
    throw new OrunError("INVALID_REQUEST", `Component path must not contain '..' traversal: ${path}`);
  }
}

function deriveLatestStatus(
  environments: Array<{ name: string; status?: string }> | undefined
): CatalogComponentStatus {
  if (!environments || environments.length === 0) return "unknown";
  const statuses = environments.map((e) => e.status ?? "unknown");
  if (statuses.some((s) => s === "failing")) return "failing";
  if (statuses.every((s) => s === "healthy")) return "healthy";
  if (statuses.some((s) => s === "stale")) return "stale";
  return "unknown";
}

// Resolve the visible *canonical* (kind=repo) namespace IDs for a session.
// Local namespaces (kind=local or prefix "local:") are excluded from catalog reads.
async function resolveVisibleCatalogNamespaceIds(
  authCtx: RequestContext & { type: "session" },
  db: D1Database,
): Promise<string[]> {
  const account = await getAccountByLogin(db, authCtx.actor);
  if (!account) return [];

  const result = await db
    .prepare(
      `SELECT n.namespace_id FROM account_repos ar JOIN namespaces n ON n.namespace_id = ar.namespace_id WHERE ar.account_id = ?1 AND (n.namespace_kind IS NULL OR n.namespace_kind = 'repo')`
    )
    .bind(account.account_id)
    .all<{ namespace_id: string }>();

  return (result.results ?? []).map((r) => r.namespace_id);
}

export async function handleCatalogSync(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "oidc") {
    throw new OrunError("FORBIDDEN", "Catalog sync requires GitHub Actions OIDC authentication");
  }

  // Enforce body size limit before parsing
  const contentLength = rc.request.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    throw new OrunError("INVALID_REQUEST", "Request body exceeds 1 MiB limit");
  }

  let rawBody: string;
  try {
    rawBody = await rc.request.text();
  } catch {
    throw new OrunError("INVALID_REQUEST", "Failed to read request body");
  }

  if (rawBody.length > MAX_BODY_BYTES) {
    throw new OrunError("INVALID_REQUEST", "Request body exceeds 1 MiB limit");
  }

  let envelope: CatalogSyncEnvelope;
  try {
    envelope = JSON.parse(rawBody) as CatalogSyncEnvelope;
  } catch {
    throw new OrunError("INVALID_REQUEST", "Invalid JSON body");
  }

  // Validate required fields
  if (!envelope.uploadId || typeof envelope.uploadId !== "string" || envelope.uploadId.trim() === "") {
    throw new OrunError("INVALID_REQUEST", "uploadId is required");
  }
  if (!envelope.schemaVersion) {
    throw new OrunError("INVALID_REQUEST", "schemaVersion is required");
  }
  if (envelope.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new OrunError("INVALID_REQUEST", `Unsupported schemaVersion: ${envelope.schemaVersion}`);
  }
  if (!envelope.source?.repoId || typeof envelope.source.repoId !== "string") {
    throw new OrunError("INVALID_REQUEST", "source.repoId is required");
  }
  if (!envelope.source?.repo || typeof envelope.source.repo !== "string") {
    throw new OrunError("INVALID_REQUEST", "source.repo is required");
  }
  if (!envelope.source?.commit || typeof envelope.source.commit !== "string") {
    throw new OrunError("INVALID_REQUEST", "source.commit is required");
  }

  // OIDC repo claims must match envelope source
  const oidcRepoId = rc.authCtx.namespace.namespaceId;
  const oidcRepo = rc.authCtx.namespace.namespaceSlug;

  if (envelope.source.repoId !== oidcRepoId) {
    throw new OrunError(
      "FORBIDDEN",
      `OIDC repository_id (${oidcRepoId}) does not match envelope source.repoId (${envelope.source.repoId})`
    );
  }
  if (envelope.source.repo !== oidcRepo) {
    throw new OrunError(
      "FORBIDDEN",
      `OIDC repository (${oidcRepo}) does not match envelope source.repo (${envelope.source.repo})`
    );
  }

  // Validate all component paths
  if (Array.isArray(envelope.components)) {
    for (const cs of envelope.components) {
      if (cs.component?.path !== undefined) {
        validateComponentPath(cs.component.path);
      }
      if (!cs.component?.id || typeof cs.component.id !== "string") {
        throw new OrunError("INVALID_REQUEST", "component.id is required for each component");
      }
      if (!cs.component?.name || typeof cs.component.name !== "string") {
        throw new OrunError("INVALID_REQUEST", "component.name is required for each component");
      }
    }
  }

  const namespaceId = oidcRepoId;
  const db = new D1Index(rc.env.DB);
  const r2 = new R2Storage(rc.env.STORAGE);

  // Idempotency: check if this uploadId already exists
  const alreadyExists = await db.uploadExists(envelope.uploadId);
  if (alreadyExists) {
    const existing = await db.recordCatalogUpload({
      uploadId: envelope.uploadId,
      namespaceId,
      repoId: envelope.source.repoId,
      repoFullName: envelope.source.repo,
      commitSha: envelope.source.commit,
      envelopeRef: "",
      componentCount: 0,
      createdAt: new Date().toISOString(),
    });
    return json(existing, 202);
  }

  const normalizePromise = async () => {
    // Upsert canonical repo namespace
    await db.upsertNamespace({
      namespaceId,
      namespaceSlug: envelope.source.repo,
      kind: "repo",
    });

    // Write raw envelope to R2
    const envelopeRef = await r2.writeCatalogEnvelope(namespaceId, envelope.uploadId, envelope);

    const now = new Date().toISOString();
    const componentCount = envelope.components?.length ?? 0;

    // Record the upload
    const uploadInput: CatalogUploadInput = {
      uploadId: envelope.uploadId,
      namespaceId,
      repoId: envelope.source.repoId,
      repoFullName: envelope.source.repo,
      commitSha: envelope.source.commit,
      branch: envelope.source.branch,
      workflowRunId: envelope.source.workflowRunId,
      workflowRef: envelope.source.workflowRef,
      prNumber: envelope.source.prNumber,
      envelopeRef,
      componentCount,
      createdAt: now,
    };
    await db.recordCatalogUpload(uploadInput);

    // Normalize each component
    for (const cs of (envelope.components ?? [])) {
      const stateRef = await r2.writeCatalogComponentState(
        namespaceId,
        envelope.source.commit,
        cs.component.name,
        cs
      );

      // Fetch existing component to detect changes
      const existingRow = await db.getCatalogComponentRow(cs.component.id);

      const latestStatus = deriveLatestStatus(cs.environments);

      const upsert: CatalogComponentUpsert = {
        componentId: cs.component.id,
        namespaceId,
        repoId: envelope.source.repoId,
        repoFullName: envelope.source.repo,
        name: cs.component.name,
        title: cs.component.title,
        description: cs.component.description,
        type: cs.component.type,
        owner: cs.component.owner,
        system: cs.component.system,
        lifecycle: cs.component.lifecycle,
        repoPath: cs.component.path,
        tags: cs.component.tags ?? [],
        environments: cs.environments ?? [],
        latestPlanId: cs.plan?.planId,
        latestPlanChecksum: cs.plan?.checksum,
        latestCommitSha: envelope.source.commit,
        latestStatus,
        currentStateRef: stateRef,
        firstSeenAt: existingRow ? (existingRow.first_seen_at as string) : now,
        lastSeenAt: now,
      };

      await db.upsertCatalogComponent(upsert);

      // Replace relations for this component
      const relations: CatalogRelationInput[] = [];
      for (const rel of (cs.relations ?? [])) {
        const relationId = await deriveRelationId([
          cs.component.id,
          rel.relationType,
          rel.targetKind,
          rel.targetRef,
          rel.environment ?? null,
          rel.jobId ?? null,
        ]);
        relations.push({
          relationId,
          sourceComponentId: cs.component.id,
          relationType: rel.relationType,
          targetKind: rel.targetKind,
          targetRef: rel.targetRef,
          environment: rel.environment,
          jobId: rel.jobId,
          lastSeenAt: now,
        });
      }
      await db.replaceCatalogRelations(cs.component.id, relations);

      // Determine event type
      let eventType: CatalogEventInput["eventType"] = "synced";
      if (!existingRow) {
        eventType = "created";
      } else if (
        existingRow.latest_commit_sha !== envelope.source.commit ||
        existingRow.owner !== (cs.component.owner ?? null) ||
        existingRow.type !== cs.component.type ||
        existingRow.system !== (cs.component.system ?? null) ||
        existingRow.lifecycle !== (cs.component.lifecycle ?? null)
      ) {
        eventType = "updated";
      }

      if (cs.source?.prNumber !== undefined) {
        eventType = "pr_changed";
      }

      const eventId = await deriveRelationId([
        cs.component.id,
        envelope.uploadId,
        eventType,
        envelope.source.commit,
      ]);

      const eventInput: CatalogEventInput = {
        eventId,
        componentId: cs.component.id,
        namespaceId,
        uploadId: envelope.uploadId,
        eventType,
        commitSha: envelope.source.commit,
        prNumber: cs.source?.prNumber ?? envelope.source.prNumber,
        createdAt: now,
      };

      await db.appendCatalogComponentEvent(eventInput);
    }
  };

  rc.ctx.waitUntil(normalizePromise());

  return json(
    {
      uploadId: envelope.uploadId,
      acceptedAt: new Date().toISOString(),
      componentCount: envelope.components?.length ?? 0,
    },
    202
  );
}

export async function handleListCatalogComponents(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, rc.env.DB);
  const url = new URL(rc.request.url);
  const sp = url.searchParams;

  const filter: CatalogComponentFilter = {
    visibleNamespaceIds,
    q: sp.get("q") ?? undefined,
    repoId: sp.get("repoId") ?? undefined,
    type: sp.get("type") ?? undefined,
    owner: sp.get("owner") ?? undefined,
    system: sp.get("system") ?? undefined,
    tag: sp.get("tag") ?? undefined,
    status: sp.get("status") ?? undefined,
    limit: sp.has("limit") ? Math.min(parseInt(sp.get("limit")!, 10) || 50, 100) : 50,
    offset: sp.has("offset") ? Math.max(parseInt(sp.get("offset")!, 10) || 0, 0) : 0,
  };

  const db = new D1Index(rc.env.DB);
  const result = await db.listCatalogComponents(filter);
  return json(result);
}

export async function handleGetCatalogComponent(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const { componentId } = rc.params;
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, rc.env.DB);

  const db = new D1Index(rc.env.DB);
  const component = await db.getCatalogComponent(visibleNamespaceIds, componentId);
  if (!component) {
    throw new OrunError("NOT_FOUND", "Component not found");
  }
  return json({ component });
}

export async function handleGetCatalogComponentHistory(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const { componentId } = rc.params;
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, rc.env.DB);

  const db = new D1Index(rc.env.DB);
  const events = await db.listCatalogComponentEvents(visibleNamespaceIds, componentId);
  return json({ events });
}

export async function handleGetCatalogComponentRuns(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const { componentId } = rc.params;
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, rc.env.DB);

  // Resolve component name from ID to query runs by component name
  const db = new D1Index(rc.env.DB);
  const component = await db.getCatalogComponent(visibleNamespaceIds, componentId);
  if (!component) {
    throw new OrunError("NOT_FOUND", "Component not found");
  }

  const runs = await db.listCatalogComponentRecentRuns(visibleNamespaceIds, component.name);
  return json({ runs });
}

export async function handleGetCatalogComponentDependencies(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const { componentId } = rc.params;
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, rc.env.DB);

  const db = new D1Index(rc.env.DB);
  const relations = await db.listCatalogComponentRelations(visibleNamespaceIds, componentId);
  return json(relations);
}

export async function handleListRepoComponents(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const { repoId } = rc.params;
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, rc.env.DB);
  const url = new URL(rc.request.url);
  const sp = url.searchParams;

  const filter: CatalogComponentFilter = {
    visibleNamespaceIds,
    repoId,
    q: sp.get("q") ?? undefined,
    type: sp.get("type") ?? undefined,
    owner: sp.get("owner") ?? undefined,
    system: sp.get("system") ?? undefined,
    tag: sp.get("tag") ?? undefined,
    status: sp.get("status") ?? undefined,
    limit: sp.has("limit") ? Math.min(parseInt(sp.get("limit")!, 10) || 50, 100) : 50,
    offset: sp.has("offset") ? Math.max(parseInt(sp.get("offset")!, 10) || 0, 0) : 0,
  };

  const db = new D1Index(rc.env.DB);
  const result = await db.listCatalogComponents(filter);
  return json(result);
}
