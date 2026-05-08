import type { CatalogSyncEnvelope, CatalogComponentStatus } from "@orun/types";
import { D1Index, R2Storage } from "@orun/storage";
import type { CatalogComponentUpsert, CatalogRelationInput, CatalogEventInput } from "@orun/storage";
import { OrunError } from "./auth/errors";

export const SUPPORTED_SCHEMA_VERSION = "1";

export async function deriveRelationId(parts: (string | null | undefined)[]): Promise<string> {
  const data = new TextEncoder().encode(parts.map((p) => p ?? "").join("\x1f"));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function validateComponentPath(path: string): void {
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

export function deriveLatestStatus(
  environments: Array<{ name: string; status?: string }> | undefined
): CatalogComponentStatus {
  if (!environments || environments.length === 0) return "unknown";
  const statuses = environments.map((e) => e.status ?? "unknown");
  if (statuses.some((s) => s === "failing")) return "failing";
  if (statuses.every((s) => s === "healthy")) return "healthy";
  if (statuses.some((s) => s === "stale")) return "stale";
  return "unknown";
}

export async function normalizeComponents(
  catalogIndex: D1Index,
  r2: R2Storage,
  envelope: CatalogSyncEnvelope,
  namespaceId: string,
  now: string,
): Promise<void> {
  for (const cs of (envelope.components ?? [])) {
    const stateRef = await r2.writeCatalogComponentState(
      namespaceId,
      envelope.source.commit,
      cs.component.name,
      cs
    );

    const existingRow = await catalogIndex.getCatalogComponentRow(cs.component.id);
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

    await catalogIndex.upsertCatalogComponent(upsert);

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
    await catalogIndex.replaceCatalogRelations(cs.component.id, relations);

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

    await catalogIndex.appendCatalogComponentEvent(eventInput);
  }
}
