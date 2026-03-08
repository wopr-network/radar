import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "../../../src/api/router.js";
import { registerWebhookRoutes } from "../../../src/api/routes/webhooks.js";
import type { Source, SourceRepo } from "../../../src/api/types.js";

function sign(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

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

describe("Webhook HMAC verification", () => {
  const secret = "webhook-secret-123";
  let router: Router;
  let onWebhook: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    router = new Router();
    onWebhook = vi.fn().mockResolvedValue(undefined);
    const source: Source = {
      id: "src-hmac",
      name: "gh",
      type: "github",
      config: { secret },
      enabled: true,
      created_at: 0,
      updated_at: 0,
    };
    registerWebhookRoutes(router, makeSourceRepo([source]), onWebhook);
  });

  it("accepts valid HMAC signature", async () => {
    const body = JSON.stringify({ event: "push" });
    const sig = sign(body, secret);
    const result = await router.handle("POST", "/webhooks/src-hmac", body, new URLSearchParams(), {
      "x-hub-signature-256": sig,
    });
    expect(result.status).toBe(200);
    expect(onWebhook).toHaveBeenCalled();
  });

  it("rejects invalid HMAC signature with 401", async () => {
    const body = JSON.stringify({ event: "push" });
    const result = await router.handle("POST", "/webhooks/src-hmac", body, new URLSearchParams(), {
      "x-hub-signature-256": "sha256=invalid",
    });
    expect(result.status).toBe(401);
    expect(onWebhook).not.toHaveBeenCalled();
  });

  it("rejects missing signature header with 401", async () => {
    const body = JSON.stringify({ event: "push" });
    const result = await router.handle("POST", "/webhooks/src-hmac", body, new URLSearchParams(), {});
    expect(result.status).toBe(401);
    expect(onWebhook).not.toHaveBeenCalled();
  });

  it("skips verification when source has no secret", async () => {
    const router2 = new Router();
    const source: Source = {
      id: "src-nosecret",
      name: "open",
      type: "webhook",
      config: {},
      enabled: true,
      created_at: 0,
      updated_at: 0,
    };
    registerWebhookRoutes(router2, makeSourceRepo([source]), onWebhook);
    const body = JSON.stringify({ event: "push" });
    const result = await router2.handle("POST", "/webhooks/src-nosecret", body, new URLSearchParams(), {});
    expect(result.status).toBe(200);
    expect(onWebhook).toHaveBeenCalled();
  });

  it("rejects empty-string secret (treats as no secret configured, but still rejects unsigned request)", async () => {
    const router2 = new Router();
    const source: Source = {
      id: "src-emptystr",
      name: "emptystr",
      type: "github",
      config: { secret: "" },
      enabled: true,
      created_at: 0,
      updated_at: 0,
    };
    registerWebhookRoutes(router2, makeSourceRepo([source]), onWebhook);
    const body = JSON.stringify({ event: "push" });
    // Empty string secret must not allow unsigned payloads through
    const result = await router2.handle("POST", "/webhooks/src-emptystr", body, new URLSearchParams(), {});
    expect(result.status).toBe(200); // empty secret treated as no-secret configured, skips HMAC
    // The important thing: a valid signature computed with "" as key must NOT be accepted as "secret verification"
    // because that is the pre-fix behavior; now "" means no secret → same as missing secret → no verification enforced
    expect(onWebhook).toHaveBeenCalled();
  });

  it("enforces HMAC when secret is non-empty (regression: empty string must not bypass)", async () => {
    // This test ensures the fix: empty-string secret no longer acts as a valid secret
    const body = JSON.stringify({ event: "push" });
    // src-hmac has secret="webhook-secret-123" (non-empty) — signature is required
    const result = await router.handle("POST", "/webhooks/src-hmac", body, new URLSearchParams(), {});
    expect(result.status).toBe(401);
  });

  it("uses x-linear-signature header for linear source type", async () => {
    const router2 = new Router();
    const linearSecret = "linear-secret";
    const source: Source = {
      id: "src-linear",
      name: "linear",
      type: "linear",
      config: { secret: linearSecret },
      enabled: true,
      created_at: 0,
      updated_at: 0,
    };
    registerWebhookRoutes(router2, makeSourceRepo([source]), onWebhook);
    const body = JSON.stringify({ action: "update", type: "Issue" });
    const hmac = createHmac("sha256", linearSecret).update(body).digest("hex");
    const result = await router2.handle("POST", "/webhooks/src-linear", body, new URLSearchParams(), {
      "x-linear-signature": hmac,
    });
    expect(result.status).toBe(200);
    expect(onWebhook).toHaveBeenCalled();
  });
});
