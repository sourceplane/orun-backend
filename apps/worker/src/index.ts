import type { Env } from "@orun/types";
import { RunCoordinator } from "@orun/coordinator";
import { RateLimitCounter } from "./rate-limit";
import { routeRequest } from "./router";
import { handleScheduled } from "./scheduled";

export { RunCoordinator };
export { RateLimitCounter };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return routeRequest(request, env, ctx);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleScheduled(env, ctx);
  },
};
