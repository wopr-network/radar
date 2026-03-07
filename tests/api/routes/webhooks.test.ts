import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "../../../src/api/router.js";
import { registerWebhookRoutes } from "../../../src/api/routes/webhooks.js";
import type { Source, SourceRepo } from "../../../src/api/types.js";

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

describe("Webhook Routes", () => {
  let router: Router;
  let onWebhook: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    router = new Router();
    onWebhook = vi.fn().mockResolvedValue(undefined);
    const source: Source = {
      id: "src-1",
      name: "gh",
      type: "webhook",
      config: {},
      enabled: true,
      created_at: 0,
      updated_at: 0,
    };
    const repo = makeSourceRepo([source]);
    registerWebhookRoutes(router, repo, onWebhook);
  });

  it("POST /webhooks/:sourceId delegates to onWebhook", async () => {
    const payload = { event: "push" };
    const result = await router.handle("POST", "/webhooks/src-1", JSON.stringify(payload), new URLSearchParams());
    expect(result.status).toBe(200);
    expect(onWebhook).toHaveBeenCalledWith("src-1", payload);
  });

  it("POST /webhooks/:sourceId returns 404 for unknown source", async () => {
    const result = await router.handle("POST", "/webhooks/unknown", JSON.stringify({}), new URLSearchParams());
    expect(result.status).toBe(404);
  });

  it("POST /webhooks/:sourceId returns 400 for disabled source", async () => {
    const disabled: Source = {
      id: "src-off",
      name: "off",
      type: "webhook",
      config: {},
      enabled: false,
      created_at: 0,
      updated_at: 0,
    };
    const router2 = new Router();
    registerWebhookRoutes(router2, makeSourceRepo([disabled]), onWebhook);
    const result = await router2.handle("POST", "/webhooks/src-off", JSON.stringify({}), new URLSearchParams());
    expect(result.status).toBe(400);
    expect(onWebhook).not.toHaveBeenCalled();
  });
});
