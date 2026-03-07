import { describe, expect, it } from "vitest";
import { Router } from "../../src/api/router.js";

describe("Router", () => {
  it("matches a static path", async () => {
    const router = new Router();
    router.add("GET", "/api/sources", async () => ({ status: 200, body: { ok: true } }));

    const result = await router.handle("GET", "/api/sources", "", new URLSearchParams());
    expect(result).toEqual({ status: 200, body: { ok: true } });
  });

  it("extracts path params", async () => {
    const router = new Router();
    router.add("GET", "/api/sources/:id", async (ctx) => ({
      status: 200,
      body: { id: ctx.params.id },
    }));

    const result = await router.handle("GET", "/api/sources/abc-123", "", new URLSearchParams());
    expect(result).toEqual({ status: 200, body: { id: "abc-123" } });
  });

  it("extracts multiple path params", async () => {
    const router = new Router();
    router.add("POST", "/webhooks/:sourceId", async (ctx) => ({
      status: 200,
      body: { sourceId: ctx.params.sourceId },
    }));

    const result = await router.handle("POST", "/webhooks/src-1", "{}", new URLSearchParams());
    expect(result).toEqual({ status: 200, body: { sourceId: "src-1" } });
  });

  it("returns 404 for unmatched path", async () => {
    const router = new Router();
    const result = await router.handle("GET", "/nope", "", new URLSearchParams());
    expect(result).toEqual({ status: 404, body: { error: "Not found" } });
  });

  it("returns 405 for wrong method on matched path", async () => {
    const router = new Router();
    router.add("GET", "/api/sources", async () => ({ status: 200, body: [] }));

    const result = await router.handle("DELETE", "/api/sources", "", new URLSearchParams());
    expect(result).toEqual({ status: 405, body: { error: "Method not allowed" } });
  });

  it("parses JSON body", async () => {
    const router = new Router();
    router.add("POST", "/api/sources", async (ctx) => ({
      status: 201,
      body: ctx.body,
    }));

    const result = await router.handle("POST", "/api/sources", '{"name":"test"}', new URLSearchParams());
    expect(result).toEqual({ status: 201, body: { name: "test" } });
  });

  it("returns 400 for invalid JSON body on POST/PUT", async () => {
    const router = new Router();
    router.add("POST", "/api/sources", async () => ({ status: 201, body: {} }));

    const result = await router.handle("POST", "/api/sources", "not json{", new URLSearchParams());
    expect(result).toEqual({ status: 400, body: { error: "Invalid JSON body" } });
  });

  it("first match wins", async () => {
    const router = new Router();
    router.add("GET", "/api/sources/:id", async () => ({ status: 200, body: "specific" }));
    router.add("GET", "/api/:resource/:id", async () => ({ status: 200, body: "generic" }));

    const result = await router.handle("GET", "/api/sources/123", "", new URLSearchParams());
    expect(result).toEqual({ status: 200, body: "specific" });
  });
});
