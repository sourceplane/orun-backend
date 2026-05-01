import type { Env } from "@orun/types";
import { RunCoordinator } from "@orun/coordinator";

export { RunCoordinator };

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    return new Response("orun-api", { status: 200 });
  },
};
