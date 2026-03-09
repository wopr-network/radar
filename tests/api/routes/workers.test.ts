import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/api/router.js";
import { registerWorkerRoutes } from "../../../src/api/routes/workers.js";
import type { RegisterWorkerInput, WorkerRepo, WorkerRow } from "../../../src/api/types.js";

function makeWorkerRepo(): WorkerRepo & { _data: Map<string, WorkerRow>; create(data: Omit<WorkerRow, "id" | "createdAt">): WorkerRow } {
  const _data = new Map<string, WorkerRow>();
  return {
    _data,
    create(data: Omit<WorkerRow, "id" | "createdAt">): WorkerRow {
      const worker: WorkerRow = {
        id: crypto.randomUUID(),
        ...data,
        createdAt: Date.now(),
      };
      _data.set(worker.id, worker);
      return worker;
    },
    list(): WorkerRow[] {
      return Array.from(_data.values());
    },
    getById(id: string): WorkerRow | undefined {
      return _data.get(id);
    },
    register(input: RegisterWorkerInput): WorkerRow {
      const worker: WorkerRow = {
        id: crypto.randomUUID(),
        name: input.name,
        type: input.type,
        discipline: input.discipline,
        status: "idle",
        config: input.config ?? null,
        lastHeartbeat: Date.now(),
        createdAt: Date.now(),
      };
      _data.set(worker.id, worker);
      return worker;
    },
    deregister(id: string): void {
      _data.delete(id);
    },
    heartbeat(id: string): void {
      const w = _data.get(id);
      if (w) w.lastHeartbeat = Date.now();
    },
    setStatus(id: string, status: string): void {
      const w = _data.get(id);
      if (w) w.status = status;
    },
    listByStatus(status: string): WorkerRow[] {
      return Array.from(_data.values()).filter((w) => w.status === status);
    },
  };
}

describe("Worker Routes", () => {
  let router: Router;
  let repo: ReturnType<typeof makeWorkerRepo>;

  beforeEach(() => {
    router = new Router();
    repo = makeWorkerRepo();
    registerWorkerRoutes(router, repo);
  });

  it("GET /api/workers returns empty list", async () => {
    const result = await router.handle("GET", "/api/workers", "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  it("POST /api/workers creates a worker", async () => {
    const result = await router.handle(
      "POST",
      "/api/workers",
      JSON.stringify({ name: "w1", type: "wopr", discipline: "engineering", status: "idle", config: null, lastHeartbeat: 0 }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(201);
    expect((result.body as WorkerRow).name).toBe("w1");
  });

  it("POST /api/workers returns 400 when name is missing", async () => {
    const result = await router.handle("POST", "/api/workers", JSON.stringify({ type: "wopr" }), new URLSearchParams());
    expect(result.status).toBe(400);
  });

  it("DELETE /api/workers/:id deletes a worker", async () => {
    const w = repo.create({
      name: "w1",
      type: "wopr",
      discipline: "engineering",
      status: "idle",
      config: null,
      lastHeartbeat: 0,
    });
    const result = await router.handle("DELETE", `/api/workers/${w.id}`, "", new URLSearchParams());
    expect(result.status).toBe(200);
  });

  it("DELETE /api/workers/:id returns 404 for missing", async () => {
    const result = await router.handle("DELETE", "/api/workers/nope", "", new URLSearchParams());
    expect(result.status).toBe(404);
  });
});
