import type { Plan } from "@orun/types";
import { runLogPath, planPath } from "@orun/types/paths";

export class R2Storage {
  constructor(private bucket: R2Bucket) {}

  async writeLog(
    namespaceId: string,
    runId: string,
    jobId: string,
    content: string | ReadableStream,
    options?: { expiresAt?: string | Date }
  ): Promise<string> {
    const key = runLogPath(namespaceId, runId, jobId);
    const putOptions: R2PutOptions = {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    };
    if (options?.expiresAt) {
      const isoString =
        options.expiresAt instanceof Date
          ? options.expiresAt.toISOString()
          : options.expiresAt;
      putOptions.customMetadata = { "expires-at": isoString };
    }
    await this.bucket.put(key, content, putOptions);
    return key;
  }

  async readLog(
    namespaceId: string,
    runId: string,
    jobId: string
  ): Promise<R2ObjectBody | null> {
    const key = runLogPath(namespaceId, runId, jobId);
    return this.bucket.get(key);
  }

  async savePlan(namespaceId: string, plan: Plan): Promise<string> {
    const key = planPath(namespaceId, plan.checksum);
    await this.bucket.put(key, JSON.stringify(plan), {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
    });
    return key;
  }

  async getPlan(namespaceId: string, checksum: string): Promise<Plan | null> {
    const key = planPath(namespaceId, checksum);
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return (await obj.json()) as Plan;
  }

  async listRunLogs(namespaceId: string, runId: string): Promise<string[]> {
    const prefix = `${namespaceId}/runs/${runId}/logs/`;
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const listed = await this.bucket.list({ prefix, cursor });
      for (const obj of listed.objects) {
        keys.push(obj.key);
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    return keys;
  }

  async deleteRun(namespaceId: string, runId: string): Promise<void> {
    const prefix = `${namespaceId}/runs/${runId}/`;
    let cursor: string | undefined;
    do {
      const listed = await this.bucket.list({ prefix, cursor });
      const keysToDelete = listed.objects.map((obj) => obj.key);
      if (keysToDelete.length > 0) {
        await this.bucket.delete(keysToDelete);
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }
}
