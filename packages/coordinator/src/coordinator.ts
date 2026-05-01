export class RunCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("RunCoordinator placeholder", { status: 200 });
  }
}
