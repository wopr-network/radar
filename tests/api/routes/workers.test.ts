import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/api/router.js";
import { registerWorkerRoutes } from "../../../src/api/routes/workers.js";
import type { Worker, WorkerRepo } from "../../../src/api/types.js";

function makeWorkerRepo(): WorkerRepo & { _data: Map<string, Worker> } {
  const _data = new Map<string, Worker>();
  return {
    _data,
    async findAll() {
      return Array.from(_data.values());
    },
    async findById(id) {
      return _data.get(id);
    },
    async create(data) {
      const worker: Worker = {
        id: crypto.randomUUID(),
        ...data,
        created_at: Date.now(),
      };
      _data.set(worker.id, worker);
      return worker;
    },
    async delete(id) {
      return _data.delete(id);
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
      JSON.stringify({ name: "w1", type: "wopr", discipline: "engineering", status: "idle", config: null, last_heartbeat: 0 }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(201);
    expect((result.body as Worker).name).toBe("w1");
  });

  it("POST /api/workers returns 400 when name is missing", async () => {
    const result = await router.handle("POST", "/api/workers", JSON.stringify({ type: "wopr" }), new URLSearchParams());
    expect(result.status).toBe(400);
  });

  it("DELETE /api/workers/:id deletes a worker", async () => {
    const w = await repo.create({
      name: "w1",
      type: "wopr",
      discipline: "engineering",
      status: "idle",
      config: null,
      last_heartbeat: 0,
    });
    const result = await router.handle("DELETE", `/api/workers/${w.id}`, "", new URLSearchParams());
    expect(result.status).toBe(200);
  });

  it("DELETE /api/workers/:id returns 404 for missing", async () => {
    const result = await router.handle("DELETE", "/api/workers/nope", "", new URLSearchParams());
    expect(result.status).toBe(404);
  });
});
