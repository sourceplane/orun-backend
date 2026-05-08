import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Env, CatalogIngestMessage, CatalogSyncEnvelope } from "@orun/types";
import { handleCatalogIngestQueue } from "./catalog-queue";

// ─── Mocks ───────────────────────────────────────────────────────────────────

function makeR2Bucket(initialStore?: Map<string, string>) {
  const store: Map<string, string> = initialStore ?? new Map();
  return {
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, typeof value === "string" ? value : JSON.stringify(value));
      return {} as R2Object;
    }),
    get: vi.fn(async (key: string) => {
      const item = store.get(key);
      if (!item) return null;
      return {
        text: async () => item,
        json: async () => JSON.parse(item),
      } as unknown as R2ObjectBody;
    }),
    delete: vi.fn(async () => {}),
    list: vi.fn(async () => ({ objects: [], truncated: false, cursor: "" })),
    head: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
    _store: store,
  } as unknown as R2Bucket & { _store: Map<string, string> };
}

function makeFailingR2Bucket() {
  return {
    put: vi.fn(async () => { throw new Error("R2 transient error"); }),
    get: vi.fn(async () => { throw new Error("R2 transient error"); }),
    delete: vi.fn(),
    list: vi.fn(),
    head: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function makeD1Database(): D1Database {
  const prepared = vi.fn((_sql: string) => ({
    bind: (..._args: unknown[]) => ({
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
      all: vi.fn(async () => ({ results: [] })),
      first: vi.fn(async () => null),
    }),
  }));
  return { prepare: prepared } as unknown as D1Database;
}

function makeFailingD1Database(): D1Database {
  const prepared = vi.fn((_sql: string) => ({
    bind: (..._args: unknown[]) => ({
      run: vi.fn(async () => { throw new Error("D1 transient error"); }),
      all: vi.fn(async () => { throw new Error("D1 transient error"); }),
      first: vi.fn(async () => null),
    }),
  }));
  return { prepare: prepared } as unknown as D1Database;
}

function makeDONamespace(): DurableObjectNamespace {
  const stub = {
    fetch: vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
  } as unknown as DurableObjectStub;
  return {
    idFromName: vi.fn(() => ({ toString: () => "test-id" })),
    get: vi.fn(() => stub),
    newUniqueId: vi.fn(),
    idFromString: vi.fn(),
    jurisdiction: vi.fn(),
  } as unknown as DurableObjectNamespace;
}

function makeEnv(opts: { r2?: R2Bucket; db?: D1Database } = {}): Env {
  return {
    COORDINATOR: makeDONamespace(),
    RATE_LIMITER: makeDONamespace(),
    STORAGE: opts.r2 ?? makeR2Bucket(),
    DB: opts.db ?? makeD1Database(),
    GITHUB_JWKS_URL: "https://token.actions.githubusercontent.com/.well-known/jwks",
    GITHUB_OIDC_AUDIENCE: "orun",
    ORUN_SESSION_SECRET: "test-secret",
  } as unknown as Env;
}

function makeExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

// ─── Message / Batch helpers ─────────────────────────────────────────────────

type MockMessage = {
  id: string;
  timestamp: Date;
  body: unknown;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
};

function makeMockMessage(body: unknown): MockMessage {
  return {
    id: "msg-" + Math.random().toString(36).slice(2),
    timestamp: new Date(),
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function makeMockBatch(messages: MockMessage[]) {
  return {
    queue: "CATALOG_INGEST_QUEUE",
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<CatalogIngestMessage>;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const VALID_MESSAGE: CatalogIngestMessage = {
  namespaceId: "123456",
  repoId: "123456",
  repoFullName: "org/repo",
  uploadId: "upl-001",
  envelopeRef: "123456/catalog/uploads/upl-001/envelope.json",
  commitSha: "abc123",
  receivedAt: "2026-01-01T00:00:00.000Z",
};

function makeValidEnvelope(overrides: Partial<CatalogSyncEnvelope> = {}): CatalogSyncEnvelope {
  return {
    apiVersion: "orun.io/v1",
    kind: "CatalogSyncEnvelope",
    uploadId: "upl-001",
    schemaVersion: "1",
    source: {
      provider: "github",
      repo: "org/repo",
      repoId: "123456",
      commit: "abc123",
    },
    components: [
      {
        apiVersion: "orun.io/v1",
        kind: "ComponentState",
        source: { provider: "github", repository: "org/repo", repoId: "123456", commit: "abc123" },
        component: {
          id: "github:123456:api-worker",
          name: "api-worker",
          type: "cloudflare-worker",
          path: "apps/api-worker",
          tags: [],
        },
        environments: [{ name: "production", status: "healthy" }],
        relations: [],
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeR2WithEnvelope(envelope: CatalogSyncEnvelope, ref = VALID_MESSAGE.envelopeRef) {
  const store = new Map<string, string>();
  store.set(ref, JSON.stringify(envelope));
  return makeR2Bucket(store);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("handleCatalogIngestQueue — success path", () => {
  it("processes a valid message: reads R2, normalizes, acks message", async () => {
    const r2 = makeR2WithEnvelope(makeValidEnvelope());
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);
    const batch = makeMockBatch([msg]);
    const ctx = makeExecutionContext();

    await handleCatalogIngestQueue(batch, env, ctx);

    expect(r2.get).toHaveBeenCalledWith(VALID_MESSAGE.envelopeRef);
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("writes component state to R2 during normalization", async () => {
    const r2 = makeR2WithEnvelope(makeValidEnvelope());
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    const stateKey = [...(r2 as unknown as { _store: Map<string, string> })._store.keys()].find(
      (k) => k.includes("catalog/commits")
    );
    expect(stateKey).toBeDefined();
    expect(stateKey).toContain("api-worker");
  });

  it("processes a batch with multiple valid messages independently", async () => {
    const envelope = makeValidEnvelope();
    const r2 = makeR2WithEnvelope(envelope);
    const env = makeEnv({ r2 });
    const msg1 = makeMockMessage(VALID_MESSAGE);
    const msg2 = makeMockMessage({ ...VALID_MESSAGE, uploadId: "upl-002" });

    // Put the same envelope for both refs (simplification for test)
    (r2 as unknown as { _store: Map<string, string> })._store.set(
      "123456/catalog/uploads/upl-002/envelope.json",
      JSON.stringify(makeValidEnvelope({ uploadId: "upl-002" }))
    );
    (msg2 as unknown as { body: CatalogIngestMessage }).body = {
      ...VALID_MESSAGE,
      uploadId: "upl-002",
      envelopeRef: "123456/catalog/uploads/upl-002/envelope.json",
    };

    await handleCatalogIngestQueue(makeMockBatch([msg1, msg2]), env, makeExecutionContext());

    expect(msg1.ack).toHaveBeenCalledTimes(1);
    expect(msg2.ack).toHaveBeenCalledTimes(1);
    expect(msg1.retry).not.toHaveBeenCalled();
    expect(msg2.retry).not.toHaveBeenCalled();
  });

  it("handles empty components array without error", async () => {
    const r2 = makeR2WithEnvelope(makeValidEnvelope({ components: [] }));
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });
});

describe("handleCatalogIngestQueue — invalid/poison messages", () => {
  it("drops message missing namespaceId — acks without retry", async () => {
    const env = makeEnv();
    const msg = makeMockMessage({ ...VALID_MESSAGE, namespaceId: "" });

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message missing envelopeRef — acks without retry", async () => {
    const env = makeEnv();
    const msg = makeMockMessage({ ...VALID_MESSAGE, envelopeRef: "" });

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message missing required fields (null body) — acks without retry", async () => {
    const env = makeEnv();
    const msg = makeMockMessage(null);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when R2 object is missing — acks without retry", async () => {
    const env = makeEnv({ r2: makeR2Bucket() }); // empty R2
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when envelope JSON is invalid — acks without retry", async () => {
    const store = new Map<string, string>();
    store.set(VALID_MESSAGE.envelopeRef, "not valid json {{{");
    const r2 = makeR2Bucket(store);
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when envelope source.repoId mismatches message repoId — acks without retry", async () => {
    const envelope = makeValidEnvelope();
    envelope.source.repoId = "WRONG_REPO_ID";
    const r2 = makeR2WithEnvelope(envelope);
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when envelope source.repo mismatches message repoFullName — acks without retry", async () => {
    const envelope = makeValidEnvelope();
    envelope.source.repo = "wrong/repo";
    const r2 = makeR2WithEnvelope(envelope);
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when envelope source.commit mismatches message commitSha — acks without retry", async () => {
    const envelope = makeValidEnvelope();
    envelope.source.commit = "wrongcommit";
    const r2 = makeR2WithEnvelope(envelope);
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when envelope components is not an array — acks without retry", async () => {
    const envelope = makeValidEnvelope({ components: "bad" as unknown as CatalogSyncEnvelope["components"] });
    const r2 = makeR2WithEnvelope(envelope);
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when namespaceId !== repoId — acks without retry", async () => {
    const env = makeEnv();
    const msg = makeMockMessage({ ...VALID_MESSAGE, namespaceId: "DIFFERENT_NS_ID" });

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when envelope.uploadId does not match message.uploadId — acks without retry", async () => {
    const envelope = makeValidEnvelope({ uploadId: "upl-WRONG" });
    const r2 = makeR2WithEnvelope(envelope);
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE); // message has uploadId "upl-001"

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when a component has an absolute path — acks without retry", async () => {
    const envelope = makeValidEnvelope();
    envelope.components[0].component.path = "/absolute/path";
    const r2 = makeR2WithEnvelope(envelope);
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("drops message when a component has path traversal — acks without retry", async () => {
    const envelope = makeValidEnvelope();
    envelope.components[0].component.path = "apps/../../../etc/passwd";
    const r2 = makeR2WithEnvelope(envelope);
    const env = makeEnv({ r2 });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("does not retry a poison message regardless of batch size", async () => {
    const env = makeEnv({ r2: makeR2Bucket() }); // empty R2 → all miss
    const msgs = [
      makeMockMessage(VALID_MESSAGE),
      makeMockMessage({ ...VALID_MESSAGE, uploadId: "upl-002" }),
    ];

    await handleCatalogIngestQueue(makeMockBatch(msgs), env, makeExecutionContext());

    for (const msg of msgs) {
      expect(msg.ack).toHaveBeenCalledTimes(1);
      expect(msg.retry).not.toHaveBeenCalled();
    }
  });
});

describe("handleCatalogIngestQueue — retry behavior", () => {
  it("retries message on transient R2 fetch failure", async () => {
    const env = makeEnv({ r2: makeFailingR2Bucket() });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it("retries message on transient D1 failure during normalization", async () => {
    const r2 = makeR2WithEnvelope(makeValidEnvelope());
    const env = makeEnv({ r2, db: makeFailingD1Database() });
    const msg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([msg]), env, makeExecutionContext());

    expect(msg.retry).toHaveBeenCalledTimes(1);
    expect(msg.ack).not.toHaveBeenCalled();
  });

  it("one poison message does not force retry of valid message in same batch", async () => {
    const r2 = makeR2WithEnvelope(makeValidEnvelope());
    const env = makeEnv({ r2 });
    // First message is poison (missing envelopeRef), second is valid
    const poisonMsg = makeMockMessage({ ...VALID_MESSAGE, envelopeRef: "" });
    const validMsg = makeMockMessage(VALID_MESSAGE);

    await handleCatalogIngestQueue(makeMockBatch([poisonMsg, validMsg]), env, makeExecutionContext());

    expect(poisonMsg.ack).toHaveBeenCalledTimes(1);
    expect(poisonMsg.retry).not.toHaveBeenCalled();
    expect(validMsg.ack).toHaveBeenCalledTimes(1);
    expect(validMsg.retry).not.toHaveBeenCalled();
  });

  it("one transient failure does not force ack of other messages in same batch", async () => {
    const r2 = makeR2Bucket();
    const failingGet = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(null);
    (r2 as unknown as Record<string, unknown>).get = failingGet;

    const env = makeEnv({ r2 });
    const failMsg = makeMockMessage(VALID_MESSAGE);
    const poisonMsg = makeMockMessage({ ...VALID_MESSAGE, uploadId: "upl-002", envelopeRef: "missing/ref" });

    await handleCatalogIngestQueue(makeMockBatch([failMsg, poisonMsg]), env, makeExecutionContext());

    expect(failMsg.retry).toHaveBeenCalledTimes(1);
    expect(failMsg.ack).not.toHaveBeenCalled();
    expect(poisonMsg.ack).toHaveBeenCalledTimes(1);
    expect(poisonMsg.retry).not.toHaveBeenCalled();
  });
});
