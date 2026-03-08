import { describe, expect, it, vi } from "vitest";
import { Router } from "../router.js";
import type { Source, SourceRepo } from "../types.js";
import { registerSourceRoutes } from "./sources.js";

function makeSource(overrides: Partial<Source>): Source {
  return {
    id: "s1",
    name: "test",
    type: "linear",
    config: {},
    enabled: true,
    created_at: 1,
    updated_at: 1,
    ...overrides,
  };
}

describe("redactSource deep redaction", () => {
  it("redacts nested credential objects in config", async () => {
    const source = makeSource({
      config: { auth: { token: "top-secret-token" }, signatureHeader: "x-sig" },
    });
    const repo = {
      findAll: vi.fn().mockResolvedValue([source]),
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as SourceRepo;

    const router = new Router();
    registerSourceRoutes(router, repo);

    const result = await router.handle("GET", "/api/sources", "", new URLSearchParams());
    const body = result.body as Array<{ config: Record<string, unknown> }>;
    const auth = body[0].config.auth as Record<string, unknown>;
    expect(auth.token).toBe("[REDACTED]");
    expect(body[0].config.signatureHeader).toBe("x-sig");
  });

  it("redacts deeply nested credentials", async () => {
    const source = makeSource({
      config: { level1: { level2: { password: "s3cr3t" } }, name: "webhook" },
    });
    const repo = {
      findAll: vi.fn().mockResolvedValue([source]),
      create: vi.fn(),
      findById: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as SourceRepo;

    const router = new Router();
    registerSourceRoutes(router, repo);

    const result = await router.handle("GET", "/api/sources", "", new URLSearchParams());
    const body = result.body as Array<{ config: Record<string, unknown> }>;
    const level1 = body[0].config.level1 as Record<string, unknown>;
    const level2 = level1.level2 as Record<string, unknown>;
    expect(level2.password).toBe("[REDACTED]");
    expect(body[0].config.name).toBe("webhook");
  });
});
