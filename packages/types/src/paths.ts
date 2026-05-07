export function runLogPath(namespaceId: string, runId: string, jobId: string): string {
  return `${namespaceId}/runs/${runId}/logs/${jobId}.log`;
}

export function planPath(namespaceId: string, checksum: string): string {
  return `${namespaceId}/plans/${checksum}.json`;
}

export function coordinatorKey(namespaceId: string, runId: string): string {
  return `${namespaceId}:${runId}`;
}

export function catalogEnvelopePath(namespaceId: string, uploadId: string): string {
  return `${namespaceId}/catalog/uploads/${uploadId}/catalog-sync-envelope.json`;
}

export function catalogComponentStatePath(namespaceId: string, commitSha: string, componentName: string): string {
  return `${namespaceId}/catalog/commits/${commitSha}/components/${componentName}.json`;
}
