import type { Env, CatalogSyncEnvelope, CatalogIngestMessage } from "@orun/types";
import type { RequestContext } from "../auth";
import { OrunError } from "../auth/errors";
import { json } from "../http";
import { D1Index } from "@orun/storage";
import { R2Storage } from "@orun/storage";
import type {
  CatalogUploadInput,
  CatalogComponentFilter,
} from "@orun/storage";
import type { StorageRouter } from "@orun/storage";
import { makeStorageRouter } from "../storage";
import { getAccountByLogin } from "./accounts";
import {
  SUPPORTED_SCHEMA_VERSION,
  validateComponentPath,
  normalizeComponents,
} from "../catalog-normalize";

const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MiB

interface RouteContext {
  request: Request;
  env: Env;
  ctx: ExecutionContext;
  params: Record<string, string>;
  authCtx: RequestContext;
}

// Resolves visible canonical (kind=repo) namespace IDs for a session.
// Local namespaces (kind=local or prefix "local:") are excluded from catalog reads.
async function resolveVisibleCatalogNamespaceIds(
  authCtx: RequestContext & { type: "session" },
  coreDb: D1Database,
): Promise<string[]> {
  const account = await getAccountByLogin(coreDb, authCtx.actor);
  if (!account) return [];

  const result = await coreDb
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

  // Validate components array and required fields
  if (!Array.isArray(envelope.components)) {
    throw new OrunError("INVALID_REQUEST", "components must be an array");
  }
  for (const cs of envelope.components) {
    if (typeof cs.component?.path !== "string") {
      throw new OrunError("INVALID_REQUEST", "component.path is required and must be a string");
    }
    validateComponentPath(cs.component.path);
    if (!cs.component?.id || typeof cs.component.id !== "string") {
      throw new OrunError("INVALID_REQUEST", "component.id is required for each component");
    }
    if (!cs.component?.name || typeof cs.component.name !== "string") {
      throw new OrunError("INVALID_REQUEST", "component.name is required for each component");
    }
  }

  const namespaceId = oidcRepoId;
  const router = makeStorageRouter(rc.env);
  const catalogIndex = new D1Index(router.catalogForNamespace(namespaceId));
  const coreIndex = new D1Index(router.core());
  const r2 = new R2Storage(rc.env.STORAGE);

  // Idempotency: check if this uploadId already exists on the catalog shard
  const alreadyExists = await catalogIndex.uploadExists(envelope.uploadId);
  if (alreadyExists) {
    const existing = await catalogIndex.recordCatalogUpload({
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

  // Sync path: upsert canonical repo namespace in core DB
  await coreIndex.upsertNamespace({
    namespaceId,
    namespaceSlug: envelope.source.repo,
    kind: "repo",
  });

  // Sync path: write raw envelope to R2
  const envelopeRef = await r2.writeCatalogEnvelope(namespaceId, envelope.uploadId, envelope);

  const now = new Date().toISOString();
  const componentCount = envelope.components?.length ?? 0;

  // Sync path: record idempotency row in catalog shard
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
  await catalogIndex.recordCatalogUpload(uploadInput);

  const ingestMessage: CatalogIngestMessage = {
    namespaceId,
    repoId: envelope.source.repoId,
    repoFullName: envelope.source.repo,
    uploadId: envelope.uploadId,
    envelopeRef,
    commitSha: envelope.source.commit,
    receivedAt: now,
  };

  if (router.hasCatalogQueue()) {
    // Queue path: enqueue pointer message for async normalization
    await router.enqueueCatalogIngest(ingestMessage);
  } else {
    // Fallback path: normalize with ctx.waitUntil (local/bootstrap)
    rc.ctx.waitUntil(normalizeComponents(catalogIndex, r2, envelope, namespaceId, now));
  }

  return json(
    {
      uploadId: envelope.uploadId,
      acceptedAt: now,
      componentCount,
    },
    202
  );
}

export async function handleListCatalogComponents(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const router = makeStorageRouter(rc.env);
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, router.core());
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

  const result = await listCatalogComponentsFromRouter(router, filter);
  return json(result);
}

export async function handleGetCatalogComponent(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const { componentId } = rc.params;
  const router = makeStorageRouter(rc.env);
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, router.core());

  const component = await getCatalogComponentFromRouter(router, visibleNamespaceIds, componentId);
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
  const router = makeStorageRouter(rc.env);
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, router.core());

  const shardMap = router.catalogForNamespaces(visibleNamespaceIds);
  const allEvents = [];
  for (const [db, nsIds] of shardMap) {
    const idx = new D1Index(db);
    const events = await idx.listCatalogComponentEvents(nsIds, componentId);
    allEvents.push(...events);
  }
  allEvents.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json({ events: allEvents });
}

export async function handleGetCatalogComponentRuns(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const { componentId } = rc.params;
  const router = makeStorageRouter(rc.env);
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, router.core());

  const component = await getCatalogComponentFromRouter(router, visibleNamespaceIds, componentId);
  if (!component) {
    throw new OrunError("NOT_FOUND", "Component not found");
  }

  const shardMap = router.catalogForNamespaces(visibleNamespaceIds);
  const allRuns = [];
  for (const [db, nsIds] of shardMap) {
    const idx = new D1Index(db);
    const runs = await idx.listCatalogComponentRecentRuns(nsIds, component.name);
    allRuns.push(...runs);
  }
  allRuns.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json({ runs: allRuns.slice(0, 10) });
}

export async function handleGetCatalogComponentDependencies(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const { componentId } = rc.params;
  const router = makeStorageRouter(rc.env);
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, router.core());

  const shardMap = router.catalogForNamespaces(visibleNamespaceIds);
  const outgoing = [];
  const incoming = [];
  for (const [db, nsIds] of shardMap) {
    const idx = new D1Index(db);
    const relations = await idx.listCatalogComponentRelations(nsIds, componentId);
    outgoing.push(...relations.outgoing);
    incoming.push(...relations.incoming);
  }
  return json({ outgoing, incoming });
}

export async function handleListRepoComponents(rc: RouteContext): Promise<Response> {
  if (rc.authCtx.type !== "session") {
    throw new OrunError("FORBIDDEN", "Session authentication required");
  }

  const { repoId } = rc.params;
  const router = makeStorageRouter(rc.env);
  const visibleNamespaceIds = await resolveVisibleCatalogNamespaceIds(rc.authCtx, router.core());
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

  const result = await listCatalogComponentsFromRouter(router, filter);
  return json(result);
}

// ─── Router-aware query helpers ───────────────────────────────────────────────

// Query each touched catalog shard for the component list, then merge.
// With single-DB fallback (all shards == coreDb), this is a direct passthrough.
async function listCatalogComponentsFromRouter(
  router: StorageRouter,
  filter: CatalogComponentFilter,
) {
  if (filter.visibleNamespaceIds.length === 0) return { components: [], total: 0 };
  const shardMap = router.catalogForNamespaces(filter.visibleNamespaceIds);

  if (shardMap.size === 1) {
    const [[db, nsIds]] = shardMap;
    return new D1Index(db).listCatalogComponents({ ...filter, visibleNamespaceIds: nsIds });
  }

  // Multi-shard: query each, merge, then re-paginate. Pagination is approximate
  // across shards; exact cross-shard pagination is deferred to a future task.
  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  let total = 0;
  const all = [];
  for (const [db, nsIds] of shardMap) {
    const res = await new D1Index(db).listCatalogComponents({ ...filter, visibleNamespaceIds: nsIds, offset: 0 });
    all.push(...res.components);
    total += res.total;
  }
  all.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  return { components: all.slice(offset, offset + limit), total };
}

// Query each touched shard for a component by ID, return first match.
async function getCatalogComponentFromRouter(
  router: StorageRouter,
  visibleNamespaceIds: string[],
  componentId: string,
) {
  if (visibleNamespaceIds.length === 0) return null;
  const shardMap = router.catalogForNamespaces(visibleNamespaceIds);
  for (const [db, nsIds] of shardMap) {
    const result = await new D1Index(db).getCatalogComponent(nsIds, componentId);
    if (result) return result;
  }
  return null;
}
