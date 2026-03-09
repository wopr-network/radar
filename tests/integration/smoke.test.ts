import { type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "../../src/api/server.js";
import type {
  AppDeps,
  EventLogEntry,
  EventLogRepo as IEventLogRepo,
  Source,
  SourceRepo as ISourceRepo,
  Watch,
  WatchRepo as IWatchRepo,
  Worker,
  WorkerRepo as IWorkerRepo,
} from "../../src/api/types.js";
import { createDb } from "../../src/db/index.js";
import { DrizzleEntityMapRepository } from "../../src/db/repos/entity-map-repo.js";
import { EventLogRepo } from "../../src/db/repos/event-log-repo.js";
import { SourceRepo } from "../../src/db/repos/source-repo.js";
import type { SourceRow } from "../../src/db/repos/source-repo.js";
import { WatchRepo } from "../../src/db/repos/watch-repo.js";
import type { WatchRow } from "../../src/db/repos/watch-repo.js";
import type { DefconClient } from "../../src/defcon/client.js";
import type { ClaimResponse, ReportResponse } from "@wopr-network/defcon";
import type { Dispatcher, DispatchOpts, WorkerResult } from "../../src/dispatcher/types.js";
import { FlowCache } from "../../src/flow-cache/index.js";
import { Ingestor } from "../../src/ingestion/ingestor.js";
import { GenericSourceAdapter, SourceAdapterRegistry } from "../../src/sources/index.js";
import { Pool } from "../../src/pool/pool.js";
import { RunLoop } from "../../src/run-loop/run-loop.js";

// --- Adapters: bridge real repos (sync, camelCase) to AppDeps interfaces (async, snake_case) ---

function toApiSource(r: SourceRow): Source {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    config: r.config,
    enabled: r.enabled,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function adaptSourceRepo(repo: SourceRepo): ISourceRepo {
  return {
    async findAll() {
      return repo.list().map(toApiSource);
    },
    async findById(id: string) {
      const r = repo.getById(id);
      return r ? toApiSource(r) : undefined;
    },
    async create(_data: Omit<Source, "id" | "created_at" | "updated_at">) {
      throw new Error("unexpected call to adaptSourceRepo.create");
    },
    async update(_id: string, _data: Partial<Source>) {
      throw new Error("unexpected call to adaptSourceRepo.update");
    },
    async delete(_id: string) {
      throw new Error("unexpected call to adaptSourceRepo.delete");
    },
  };
}

function toApiWatch(r: WatchRow): Watch {
  return {
    id: r.id,
    source_id: r.sourceId,
    name: r.name,
    filter: r.filter,
    action: r.action,
    action_config: r.actionConfig,
    enabled: r.enabled,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

function adaptWatchRepo(repo: WatchRepo): IWatchRepo {
  return {
    async findBySourceId(sourceId: string) {
      return repo.listBySource(sourceId).map(toApiWatch);
    },
    async findById(id: string) {
      const r = repo.getById(id);
      return r ? toApiWatch(r) : undefined;
    },
    async create(_data: Omit<Watch, "id" | "created_at" | "updated_at">): Promise<Watch> {
      throw new Error("unexpected call to adaptWatchRepo.create");
    },
    async update(_id: string, _data: Partial<Watch>): Promise<Watch | undefined> {
      throw new Error("unexpected call to adaptWatchRepo.update");
    },
    async delete(_id: string): Promise<boolean> {
      throw new Error("unexpected call to adaptWatchRepo.delete");
    },
  };
}

function adaptEventLogRepo(repo: EventLogRepo): IEventLogRepo {
  const store: EventLogEntry[] = [];
  return {
    async findAll(_opts?: { limit?: number; offset?: number }) {
      return [...store];
    },
    async append(data: Omit<EventLogEntry, "id" | "created_at">) {
      const row = repo.append({
        sourceId: data.source_id,
        watchId: data.watch_id,
        rawEvent: data.raw_event as Record<string, unknown>,
        actionTaken: data.action_taken,
        defconResponse: data.defcon_response as Record<string, unknown> | null,
      });
      const entry: EventLogEntry = {
        id: row.id,
        source_id: row.sourceId,
        watch_id: row.watchId,
        raw_event: row.rawEvent,
        action_taken: row.actionTaken,
        defcon_response: row.defconResponse,
        created_at: row.createdAt,
      };
      store.push(entry);
      return entry;
    },
  };
}

function adaptWorkerRepo(): IWorkerRepo {
  return {
    async findAll() {
      return [] as Worker[];
    },
    async findById(_id: string) {
      return undefined;
    },
    async create(d: Omit<Worker, "id" | "created_at">) {
      return { ...d, id: "w-smoke-1", created_at: 0 } as Worker;
    },
    async delete(_id: string) {
      return false;
    },
  };
}

// --- Echo dispatcher ---

function createEchoDispatcher(): Dispatcher & { dispatch: ReturnType<typeof vi.fn> } {
  return {
    dispatch: vi.fn(async (prompt: string, _opts: DispatchOpts): Promise<WorkerResult> => ({
      signal: "done",
      artifacts: { echo: prompt },
      exitCode: 0,
    })),
  };
}

// --- Mock DefconClient factory ---

function createMockDefcon(overrides: {
  claim: () => Promise<ClaimResponse>;
  createEntity: () => Promise<{ id: string }>;
  report: () => Promise<ReportResponse>;
}): DefconClient {
  return {
    claim: vi.fn(overrides.claim),
    createEntity: vi.fn(overrides.createEntity),
    report: vi.fn(overrides.report),
  } as unknown as DefconClient;
}

// --- Helper: POST JSON ---

async function postJson(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

// --- The smoke test ---

describe("Integration smoke test", () => {
  let server: Server;
  let port: number;
  let mockDefcon: DefconClient;
  let echoDispatcher: ReturnType<typeof createEchoDispatcher>;
  let pool: Pool;
  let runLoop: RunLoop;
  let sourceRepo: SourceRepo;
  let watchRepo: WatchRepo;

  beforeAll(async () => {
    // 1. In-memory DB + repos
    const db = createDb();
    sourceRepo = new SourceRepo(db);
    watchRepo = new WatchRepo(db);
    const eventLogRepo = new EventLogRepo(db);
    const entityMapRepo = new DrizzleEntityMapRepository(db);

    // 2. Seed a source and a watch
    const source = sourceRepo.create({
      name: "test-webhook",
      type: "webhook",
      config: {},
    });

    watchRepo.create({
      sourceId: source.id,
      name: "catch-all",
      filter: {},
      action: "ingest",
      actionConfig: { flowName: "smoke-flow" },
    });

    // 3. Mock DEFCON: first claim returns work, subsequent calls return check_back
    let claimCount = 0;
    mockDefcon = createMockDefcon({
      createEntity: async () => ({ id: "entity-smoke-1" }),
      claim: async () => {
        claimCount++;
        if (claimCount === 1) {
          return {
            entity_id: "entity-smoke-1",
            invocation_id: "inv-smoke",
            flow: "smoke-flow",
            state: "do-work",
            refs: {},
            artifacts: {},
          } satisfies ClaimResponse;
        }
        return {
          next_action: "check_back" as const,
          retry_after_ms: 600000,
          message: "No more work",
        };
      },
      report: async () => ({
        next_action: "waiting" as const,
        gated: true as const,
        gateName: "review",
        gate_output: "needs review",
      }),
    });

    echoDispatcher = createEchoDispatcher();

    // 4. Ingestor wired to mock DEFCON
    const ingestor = new Ingestor(entityMapRepo, mockDefcon);

    // 5. onWebhook: the route adapter already parsed the event; just ingest it
    const onWebhook = async (_sourceId: string, event: unknown) => {
      await ingestor.ingest(event);
    };

    // 6. Create HTTP server
    pool = new Pool(2);
    const adapterRegistry = new SourceAdapterRegistry();
    adapterRegistry.register(new GenericSourceAdapter());
    const deps: AppDeps = {
      sourceRepo: adaptSourceRepo(sourceRepo),
      watchRepo: adaptWatchRepo(watchRepo),
      eventLogRepo: adaptEventLogRepo(eventLogRepo),
      workerRepo: adaptWorkerRepo(),
      pool,
      defconClient: mockDefcon,
      onWebhook,
      adapterRegistry,
    };

    server = createServer(deps);
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;

    // 7. RunLoop wired to same mock DEFCON + echo dispatcher
    const flowCache = new FlowCache();
    flowCache.load([
      {
        name: "smoke-flow",
        initialState: "do-work",
        discipline: "engineering",
        states: [{ name: "do-work", promptTemplate: "You are working on a smoke test", modelTier: "sonnet" }],
        transitions: [{ fromState: "do-work", toState: "done", trigger: "done" }],
      },
    ]);
    runLoop = new RunLoop({
      pool,
      defcon: mockDefcon,
      dispatcher: echoDispatcher,
      flowCache,
      role: "engineering",
      pollIntervalMs: 10,
    });
  });

  afterAll(async () => {
    await runLoop.stop();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("webhook → watch match → createEntity → claim → dispatch → report", async () => {
    // Step 1: POST webhook event
    const sourceId = sourceRepo.list()[0].id;
    const webhookPayload = { externalId: "issue-42", title: "Test issue" };
    const res = await postJson(port, `/webhooks/${sourceId}`, webhookPayload);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ accepted: true });

    // Step 2: Verify defcon.createEntity called — watch matched and ingestor ran
    expect(mockDefcon.createEntity).toHaveBeenCalledOnce();
    expect(mockDefcon.createEntity).toHaveBeenCalledWith({
      flowName: "smoke-flow",
      payload: { externalId: "issue-42", title: "Test issue" },
    });

    // Step 3: Start RunLoop to drive a claim → dispatch → report cycle
    runLoop.start();

    // Wait for one full cycle (claim → dispatch → report → slot release)
    // report is called first, then the finally block releases the slot.
    // Waiting for the slot to drain guarantees report has already been called.
    await vi.waitFor(
      () => {
        // The pool starts empty; only passes after a slot was allocated AND released.
        expect(mockDefcon.report).toHaveBeenCalled();
        expect(pool.activeSlots()).toHaveLength(0);
      },
      { timeout: 5000 },
    );

    // Step 4: Verify claim was called
    expect(mockDefcon.claim).toHaveBeenCalled();

    // Step 5: Verify echo dispatcher received the prompt
    expect(echoDispatcher.dispatch).toHaveBeenCalledWith(
      "You are working on a smoke test",
      expect.objectContaining({
        modelTier: "sonnet",
        entityId: "entity-smoke-1",
      }),
    );

    // Step 6: Verify report called with dispatcher's signal + artifacts
    expect(mockDefcon.report).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "entity-smoke-1",
        signal: "done",
        artifacts: { echo: "You are working on a smoke test" },
      }),
    );
  });
});
