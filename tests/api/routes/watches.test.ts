import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/api/router.js";
import { registerWatchRoutes } from "../../../src/api/routes/watches.js";
import type { Watch, WatchRepo } from "../../../src/api/types.js";

function makeWatchRepo(): WatchRepo & { _data: Map<string, Watch> } {
  const _data = new Map<string, Watch>();
  return {
    _data,
    async findBySourceId(sourceId) {
      return Array.from(_data.values()).filter((w) => w.source_id === sourceId);
    },
    async findById(id) {
      return _data.get(id);
    },
    async create(data) {
      const watch: Watch = {
        id: crypto.randomUUID(),
        ...data,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      _data.set(watch.id, watch);
      return watch;
    },
    async update(id, data) {
      const existing = _data.get(id);
      if (!existing) return undefined;
      const updated = { ...existing, ...data, updated_at: Date.now() };
      _data.set(id, updated);
      return updated;
    },
    async delete(id) {
      return _data.delete(id);
    },
  };
}

describe("Watch Routes", () => {
  let router: Router;
  let watchRepo: ReturnType<typeof makeWatchRepo>;

  beforeEach(() => {
    router = new Router();
    watchRepo = makeWatchRepo();
    registerWatchRoutes(router, watchRepo);
  });

  it("GET /api/sources/:id/watches returns watches for source", async () => {
    await watchRepo.create({
      source_id: "src-1",
      name: "w1",
      filter: {},
      action: "create_entity",
      action_config: {},
      enabled: true,
    });
    const result = await router.handle("GET", "/api/sources/src-1/watches", "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect((result.body as Watch[]).length).toBe(1);
  });

  it("POST /api/sources/:id/watches creates a watch", async () => {
    const result = await router.handle(
      "POST",
      "/api/sources/src-1/watches",
      JSON.stringify({ name: "w1", filter: {}, action: "create_entity", action_config: {} }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(201);
    expect((result.body as Watch).source_id).toBe("src-1");
  });

  it("POST /api/sources/:id/watches returns 400 when name missing", async () => {
    const result = await router.handle(
      "POST",
      "/api/sources/src-1/watches",
      JSON.stringify({ filter: {} }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(400);
  });

  it("GET /api/watches/:id returns a watch", async () => {
    const w = await watchRepo.create({
      source_id: "s1",
      name: "w1",
      filter: {},
      action: "create_entity",
      action_config: {},
      enabled: true,
    });
    const result = await router.handle("GET", `/api/watches/${w.id}`, "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect((result.body as Watch).id).toBe(w.id);
  });

  it("GET /api/watches/:id returns 404 for missing", async () => {
    const result = await router.handle("GET", "/api/watches/nope", "", new URLSearchParams());
    expect(result.status).toBe(404);
  });

  it("PUT /api/watches/:id updates a watch", async () => {
    const w = await watchRepo.create({
      source_id: "s1",
      name: "w1",
      filter: {},
      action: "create_entity",
      action_config: {},
      enabled: true,
    });
    const result = await router.handle(
      "PUT",
      `/api/watches/${w.id}`,
      JSON.stringify({ name: "w1-updated" }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(200);
    expect((result.body as Watch).name).toBe("w1-updated");
  });

  it("DELETE /api/watches/:id deletes a watch", async () => {
    const w = await watchRepo.create({
      source_id: "s1",
      name: "w1",
      filter: {},
      action: "create_entity",
      action_config: {},
      enabled: true,
    });
    const result = await router.handle("DELETE", `/api/watches/${w.id}`, "", new URLSearchParams());
    expect(result.status).toBe(200);
  });
});
