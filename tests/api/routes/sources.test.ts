import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/api/router.js";
import { registerSourceRoutes } from "../../../src/api/routes/sources.js";
import type { Source, SourceRepo } from "../../../src/api/types.js";

function makeSourceRepo(): SourceRepo & { _data: Map<string, Source> } {
  const _data = new Map<string, Source>();
  return {
    _data,
    async findAll() {
      return Array.from(_data.values());
    },
    async findById(id) {
      return _data.get(id);
    },
    async create(data) {
      const source: Source = {
        id: crypto.randomUUID(),
        ...data,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      _data.set(source.id, source);
      return source;
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

describe("Source Routes", () => {
  let router: Router;
  let repo: ReturnType<typeof makeSourceRepo>;

  beforeEach(() => {
    router = new Router();
    repo = makeSourceRepo();
    registerSourceRoutes(router, repo);
  });

  it("GET /api/sources returns empty list", async () => {
    const result = await router.handle("GET", "/api/sources", "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect(result.body).toEqual([]);
  });

  it("POST /api/sources creates a source", async () => {
    const result = await router.handle(
      "POST",
      "/api/sources",
      JSON.stringify({ name: "gh", type: "webhook", config: {}, enabled: true }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(201);
    expect((result.body as Source).name).toBe("gh");
  });

  it("GET /api/sources/:id returns a source", async () => {
    const created = await repo.create({ name: "gh", type: "webhook", config: {}, enabled: true });
    const result = await router.handle("GET", `/api/sources/${created.id}`, "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect((result.body as Source).id).toBe(created.id);
  });

  it("GET /api/sources/:id returns 404 for missing", async () => {
    const result = await router.handle("GET", "/api/sources/nonexistent", "", new URLSearchParams());
    expect(result.status).toBe(404);
  });

  it("PUT /api/sources/:id updates a source", async () => {
    const created = await repo.create({ name: "gh", type: "webhook", config: {}, enabled: true });
    const result = await router.handle(
      "PUT",
      `/api/sources/${created.id}`,
      JSON.stringify({ name: "gh-updated" }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(200);
    expect((result.body as Source).name).toBe("gh-updated");
  });

  it("PUT /api/sources/:id returns 404 for missing", async () => {
    const result = await router.handle("PUT", "/api/sources/nope", JSON.stringify({ name: "x" }), new URLSearchParams());
    expect(result.status).toBe(404);
  });

  it("DELETE /api/sources/:id deletes a source", async () => {
    const created = await repo.create({ name: "gh", type: "webhook", config: {}, enabled: true });
    const result = await router.handle("DELETE", `/api/sources/${created.id}`, "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect(repo._data.size).toBe(0);
  });

  it("DELETE /api/sources/:id returns 404 for missing", async () => {
    const result = await router.handle("DELETE", "/api/sources/nope", "", new URLSearchParams());
    expect(result.status).toBe(404);
  });

  it("POST /api/sources redacts secret from response", async () => {
    const result = await router.handle(
      "POST",
      "/api/sources",
      JSON.stringify({ name: "secure", type: "webhook", config: { secret: "mysecret", url: "https://example.com" }, enabled: true }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(201);
    expect((result.body as Source & { config: Record<string, unknown> }).config.secret).toBeUndefined();
    expect((result.body as Source & { config: Record<string, unknown> }).config.url).toBe("https://example.com");
  });

  it("PUT /api/sources/:id redacts secret from response", async () => {
    const created = await repo.create({ name: "gh", type: "webhook", config: { secret: "s3cr3t" }, enabled: true });
    const result = await router.handle(
      "PUT",
      `/api/sources/${created.id}`,
      JSON.stringify({ name: "gh-updated" }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(200);
    expect((result.body as Source & { config: Record<string, unknown> }).config.secret).toBeUndefined();
  });

  it("POST /api/sources returns 400 when name is missing", async () => {
    const result = await router.handle(
      "POST",
      "/api/sources",
      JSON.stringify({ type: "webhook" }),
      new URLSearchParams(),
    );
    expect(result.status).toBe(400);
  });
});
