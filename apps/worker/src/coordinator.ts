import type { Env } from "@orun/types";
import { coordinatorKey } from "@orun/types/paths";

export function getCoordinator(env: Env, namespaceId: string, runId: string): DurableObjectStub {
  const key = coordinatorKey(namespaceId, runId);
  const id = env.COORDINATOR.idFromName(key);
  return env.COORDINATOR.get(id);
}

export async function coordinatorFetch(
  stub: DurableObjectStub,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return stub.fetch(new Request(`https://coordinator.local${path}`, init));
}
