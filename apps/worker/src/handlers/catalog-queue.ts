import type { Env, CatalogIngestMessage, CatalogSyncEnvelope } from "@orun/types";
import { D1Index, R2Storage } from "@orun/storage";
import { makeStorageRouter } from "../storage";
import { SUPPORTED_SCHEMA_VERSION, validateComponentPath, normalizeComponents } from "../catalog-normalize";

// Safe metadata fields logged on poison-message drop.
interface SafeDropMeta {
  uploadId: string | undefined;
  namespaceId: string | undefined;
  repoId: string | undefined;
  reason: string;
}

function logDrop(meta: SafeDropMeta): void {
  console.warn("[catalog-queue] dropping poison message", meta);
}

function isCatalogIngestMessage(body: unknown): body is CatalogIngestMessage {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b["namespaceId"] === "string" && b["namespaceId"] !== "" &&
    typeof b["repoId"] === "string" && b["repoId"] !== "" &&
    typeof b["repoFullName"] === "string" && b["repoFullName"] !== "" &&
    typeof b["uploadId"] === "string" && b["uploadId"] !== "" &&
    typeof b["envelopeRef"] === "string" && b["envelopeRef"] !== "" &&
    typeof b["commitSha"] === "string" && b["commitSha"] !== ""
  );
}

function validateEnvelopeAgainstMessage(
  envelope: CatalogSyncEnvelope,
  message: CatalogIngestMessage,
): string | null {
  if (envelope.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return `unsupported schemaVersion: ${envelope.schemaVersion}`;
  }
  if (envelope.source?.repoId !== message.repoId) {
    return "envelope source.repoId does not match message repoId";
  }
  if (envelope.source?.repo !== message.repoFullName) {
    return "envelope source.repo does not match message repoFullName";
  }
  if (envelope.source?.commit !== message.commitSha) {
    return "envelope source.commit does not match message commitSha";
  }
  if (!Array.isArray(envelope.components)) {
    return "envelope components is not an array";
  }
  for (const cs of envelope.components) {
    if (!cs.component?.id || typeof cs.component.id !== "string") {
      return "invalid component.id";
    }
    if (!cs.component?.name || typeof cs.component.name !== "string") {
      return "invalid component.name";
    }
    if (typeof cs.component?.path !== "string" || cs.component.path === "") {
      return "invalid component.path";
    }
    try {
      validateComponentPath(cs.component.path);
    } catch {
      return "invalid_component_path";
    }
  }
  return null;
}

export async function handleCatalogIngestQueue(
  batch: MessageBatch<CatalogIngestMessage>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const r2 = new R2Storage(env.STORAGE);
  const router = makeStorageRouter(env);
  const now = new Date().toISOString();

  for (const message of batch.messages) {
    const body = message.body;

    // Validate message shape — malformed messages are poison, drop immediately.
    if (!isCatalogIngestMessage(body)) {
      logDrop({
        uploadId: (body as Record<string, unknown>)?.["uploadId"] as string | undefined,
        namespaceId: (body as Record<string, unknown>)?.["namespaceId"] as string | undefined,
        repoId: (body as Record<string, unknown>)?.["repoId"] as string | undefined,
        reason: "malformed message shape",
      });
      message.ack();
      continue;
    }

    // Fetch envelope body from R2. Network/transient errors → retry; missing object → poison drop.
    let r2Body: R2ObjectBody | null;
    try {
      r2Body = await r2.readCatalogEnvelopeBody(body.envelopeRef);
    } catch {
      message.retry();
      continue;
    }

    if (!r2Body) {
      logDrop({ uploadId: body.uploadId, namespaceId: body.namespaceId, repoId: body.repoId, reason: "R2 object not found" });
      message.ack();
      continue;
    }

    // Parse JSON. Corrupted stored data is permanent — drop, not retry.
    let envelope: CatalogSyncEnvelope;
    try {
      envelope = (await r2Body.json()) as CatalogSyncEnvelope;
    } catch {
      logDrop({ uploadId: body.uploadId, namespaceId: body.namespaceId, repoId: body.repoId, reason: "invalid envelope JSON" });
      message.ack();
      continue;
    }

    // Defensive envelope validation against message routing metadata.
    const validationError = validateEnvelopeAgainstMessage(envelope, body);
    if (validationError) {
      logDrop({ uploadId: body.uploadId, namespaceId: body.namespaceId, repoId: body.repoId, reason: validationError });
      message.ack();
      continue;
    }

    // Normalize into catalog index. Transient D1/R2 failures → retry.
    try {
      const catalogIndex = new D1Index(router.catalogForNamespace(body.namespaceId));
      await normalizeComponents(catalogIndex, r2, envelope, body.namespaceId, now);
      message.ack();
    } catch {
      message.retry();
    }
  }
}
