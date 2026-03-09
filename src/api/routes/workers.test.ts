import { describe, expect, it, vi } from "vitest";
import { Router } from "../router.js";
import type { IWorkerRepo, WorkerRow } from "../types.js";
import { registerWorkerRoutes } from "./workers.js";

function makeWorkerRow(overrides: Partial<WorkerRow> = {}): WorkerRow {
  return {
    id: "w-1",
    name: "test-worker",
    type: "wopr",
    discipline: "engineering",
    status: "idle",
    config: null,
    lastHeartbeat: 1000,
    createdAt: 1000,
    ...overrides,
  };
}

function makeRepo(overrides: Partial<IWorkerRepo> = {}): IWorkerRepo {
  const row = makeWorkerRow();
  return {
    register: vi.fn().mockReturnValue(row),
    deregister: vi.fn().mockReturnValue(undefined),
    heartbeat: vi.fn().mockReturnValue(undefined),
    setStatus: vi.fn().mockReturnValue(undefined),
    getById: vi.fn().mockReturnValue(row),
    list: vi.fn().mockReturnValue([row]),
    listByStatus: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as IWorkerRepo;
}

function makeRouter(repo: IWorkerRepo): Router {
  const router = new Router();
  registerWorkerRoutes(router, repo);
  return router;
}

describe("GET /api/workers", () => {
  it("returns list of workers from repo", async () => {
    const row = makeWorkerRow({ id: "w-99" });
    const repo = makeRepo({ list: vi.fn().mockReturnValue([row]) });
    const router = makeRouter(repo);

    const result = await router.handle("GET", "/api/workers", "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect(result.body).toEqual([row]);
  });
});

describe("POST /api/workers", () => {
  it("registers a worker and returns 201 with the created row", async () => {
    const created = makeWorkerRow({ id: "w-new", name: "my-worker" });
    const repo = makeRepo({ register: vi.fn().mockReturnValue(created) });
    const router = makeRouter(repo);

    const result = await router.handle(
      "POST",
      "/api/workers",
      JSON.stringify({ name: "my-worker", type: "wopr", discipline: "coder" }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(201);
    expect(result.body).toEqual(created);
    expect(repo.register).toHaveBeenCalledWith(
      expect.objectContaining({ name: "my-worker", type: "wopr", discipline: "coder" }),
    );
  });

  it("returns 400 when body is missing required fields", async () => {
    const repo = makeRepo();
    const router = makeRouter(repo);

    const result = await router.handle(
      "POST",
      "/api/workers",
      JSON.stringify({ name: "only-name" }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(400);
  });

  it("returns 400 when body is not an object", async () => {
    const repo = makeRepo();
    const router = makeRouter(repo);

    const result = await router.handle("POST", "/api/workers", "null", new URLSearchParams());
    expect(result.status).toBe(400);
  });
});

describe("DELETE /api/workers/:id", () => {
  it("deregisters and returns 200 when worker exists", async () => {
    const repo = makeRepo();
    const router = makeRouter(repo);

    const result = await router.handle("DELETE", "/api/workers/w-1", "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect(repo.deregister).toHaveBeenCalledWith("w-1");
  });

  it("returns 404 when worker does not exist", async () => {
    const repo = makeRepo({ getById: vi.fn().mockReturnValue(undefined) });
    const router = makeRouter(repo);

    const result = await router.handle("DELETE", "/api/workers/missing", "", new URLSearchParams());
    expect(result.status).toBe(404);
    expect(repo.deregister).not.toHaveBeenCalled();
  });
});

describe("POST /api/workers/:id/heartbeat", () => {
  it("calls heartbeat and returns 200 when worker exists", async () => {
    const repo = makeRepo();
    const router = makeRouter(repo);

    const result = await router.handle("POST", "/api/workers/w-1/heartbeat", "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect(repo.heartbeat).toHaveBeenCalledWith("w-1");
  });

  it("returns 404 when worker does not exist", async () => {
    const repo = makeRepo({ getById: vi.fn().mockReturnValue(undefined) });
    const router = makeRouter(repo);

    const result = await router.handle("POST", "/api/workers/missing/heartbeat", "", new URLSearchParams());
    expect(result.status).toBe(404);
    expect(repo.heartbeat).not.toHaveBeenCalled();
  });
});
