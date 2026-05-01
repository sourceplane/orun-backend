export function runLogPath(namespaceId: string, runId: string, jobId: string): string {
  return `${namespaceId}/runs/${runId}/logs/${jobId}.log`;
}

export function planPath(namespaceId: string, checksum: string): string {
  return `${namespaceId}/plans/${checksum}.json`;
}

export function coordinatorKey(namespaceId: string, runId: string): string {
  return `${namespaceId}:${runId}`;
}
