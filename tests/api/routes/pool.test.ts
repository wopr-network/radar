import { beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "../../../src/pool/pool.js";
import { Router } from "../../../src/api/router.js";
import { registerPoolRoutes } from "../../../src/api/routes/pool.js";

describe("Pool Routes", () => {
  let router: Router;
  let pool: Pool;
  let onClaim: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    router = new Router();
    pool = new Pool(4);
    onClaim = vi.fn().mockResolvedValue({ claimed: 1 });
    registerPoolRoutes(router, pool, onClaim);
  });

  it("GET /api/pool/slots returns active slots", async () => {
    pool.allocate("s1", "w1", "e1", "do stuff");
    const result = await router.handle("GET", "/api/pool/slots", "", new URLSearchParams());
    expect(result.status).toBe(200);
    const body = result.body as { slots: unknown[]; available: number; capacity: number };
    expect(body.slots.length).toBe(1);
    expect(body.available).toBe(3);
    expect(body.capacity).toBe(4);
  });

  it("POST /api/pool/claim triggers claim cycle", async () => {
    const result = await router.handle("POST", "/api/pool/claim", "{}", new URLSearchParams());
    expect(result.status).toBe(200);
    expect(onClaim).toHaveBeenCalled();
  });
});
