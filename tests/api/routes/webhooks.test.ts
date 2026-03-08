import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "../../../src/api/router.js";
import { registerWebhookRoutes } from "../../../src/api/routes/webhooks.js";
import type { Source, SourceRepo, Watch, WatchRepo } from "../../../src/api/types.js";
import type { SourceAdapter } from "../../../src/sources/adapter.js";
import { SourceAdapterRegistry } from "../../../src/sources/adapter.js";

function makeSourceRepo(sources: Source[]): SourceRepo {
  const map = new Map(sources.map((s) => [s.id, s]));
  return {
    async findAll() {
      return Array.from(map.values());
    },
    async findById(id) {
      return map.get(id);
    },
    async create() {
      return {} as Source;
    },
    async update() {
      return undefined;
    },
    async delete() {
      return false;
    },
  };
}

function makeWatchRepo(watches: Watch[]): WatchRepo {
  return {
    async findBySourceId(sourceId) {
      return watches.filter((w) => w.source_id === sourceId);
    },
    async findById(id) {
      return watches.find((w) => w.id === id);
    },
    async create() {
      return {} as Watch;
    },
    async update() {
      return undefined;
    },
    async delete() {
      return false;
    },
  };
}

describe("Webhook Routes (adapter-based)", () => {
  let router: Router;
  let onWebhook: ReturnType<typeof vi.fn>;
  let registry: SourceAdapterRegistry;

  const source: Source = {
    id: "src-1",
    name: "test",
    type: "test-type",
    config: {},
    enabled: true,
    created_at: 0,
    updated_at: 0,
  };

  const watch: Watch = {
    id: "w-1",
    source_id: "src-1",
    name: "w",
    filter: {},
    action: "ingest",
    action_config: { flowName: "f" },
    enabled: true,
    created_at: 0,
    updated_at: 0,
  };

  beforeEach(() => {
    router = new Router();
    onWebhook = vi.fn().mockResolvedValue(undefined);
    registry = new SourceAdapterRegistry();
  });

  it("delegates to adapter.parseEvent and calls onWebhook with result", async () => {
    const mockEvent = { sourceId: "src-1", externalId: "e1", type: "new" as const, flowName: "f" };
    const adapter: SourceAdapter = {
      type: "test-type",
      parseEvent: () => mockEvent,
      verifySignature: () => ({ valid: true }),
    };
    registry.register(adapter);
    registerWebhookRoutes(router, makeSourceRepo([source]), makeWatchRepo([watch]), registry, onWebhook);

    const result = await router.handle("POST", "/webhooks/src-1", '{"x":1}', new URLSearchParams());
    expect(result.status).toBe(200);
    expect(onWebhook).toHaveBeenCalledWith("src-1", mockEvent);
  });

  it("returns 400 when no adapter registered for source type", async () => {
    registerWebhookRoutes(router, makeSourceRepo([source]), makeWatchRepo([watch]), registry, onWebhook);
    const result = await router.handle("POST", "/webhooks/src-1", "{}", new URLSearchParams());
    expect(result.status).toBe(400);
  });

  it("returns 401 when adapter.verifySignature fails", async () => {
    const adapter: SourceAdapter = {
      type: "test-type",
      parseEvent: () => null,
      verifySignature: () => ({ valid: false, error: "bad sig" }),
    };
    registry.register(adapter);
    registerWebhookRoutes(router, makeSourceRepo([source]), makeWatchRepo([watch]), registry, onWebhook);

    const result = await router.handle("POST", "/webhooks/src-1", "{}", new URLSearchParams());
    expect(result.status).toBe(401);
  });

  it("returns 200 with accepted:false when parseEvent returns null", async () => {
    const adapter: SourceAdapter = {
      type: "test-type",
      parseEvent: () => null,
      verifySignature: () => ({ valid: true }),
    };
    registry.register(adapter);
    registerWebhookRoutes(router, makeSourceRepo([source]), makeWatchRepo([watch]), registry, onWebhook);

    const result = await router.handle("POST", "/webhooks/src-1", "{}", new URLSearchParams());
    expect(result.status).toBe(200);
    expect(onWebhook).not.toHaveBeenCalled();
  });

  it("returns 401 for unknown source", async () => {
    registerWebhookRoutes(router, makeSourceRepo([source]), makeWatchRepo([]), registry, onWebhook);
    const result = await router.handle("POST", "/webhooks/unknown", "{}", new URLSearchParams());
    expect(result.status).toBe(401);
  });

  it("returns 401 for disabled source", async () => {
    const disabled: Source = { ...source, id: "src-off", enabled: false };
    const router2 = new Router();
    registerWebhookRoutes(router2, makeSourceRepo([disabled]), makeWatchRepo([]), registry, onWebhook);
    const result = await router2.handle("POST", "/webhooks/src-off", "{}", new URLSearchParams());
    expect(result.status).toBe(401);
  });
});
