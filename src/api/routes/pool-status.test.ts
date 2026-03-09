import { describe, expect, it } from "vitest";
import { Pool } from "../../pool/pool.js";
import { ThroughputTracker } from "../../pool/throughput-tracker.js";
import { Router } from "../router.js";
import { registerPoolRoutes } from "./pool.js";

describe("GET /api/pool/status", () => {
  it("returns pool status with empty pool", async () => {
    const pool = new Pool(4);
    const tracker = new ThroughputTracker();
    const router = new Router();
    registerPoolRoutes(router, pool, async () => ({}), tracker);

    const result = await router.handle("GET", "/api/pool/status", "", new URLSearchParams());
    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(body.workers).toEqual({
      active: 0,
      total_capacity: 4,
      available_slots: 4,
    });
    expect(body.slots).toEqual([]);
    expect(body.throughput).toEqual({
      completed_last_hour: 0,
      failed_last_hour: 0,
      avg_duration_ms: 0,
    });
  });

  it("reflects active slots with discipline", async () => {
    const pool = new Pool(4);
    pool.allocate("slot-0", "wkr-1", "engineering", "entity-abc", "do stuff");
    pool.setState("slot-0", "working");
    const tracker = new ThroughputTracker();
    tracker.record("completed", 1200);
    const router = new Router();
    registerPoolRoutes(router, pool, async () => ({}), tracker);

    const result = await router.handle("GET", "/api/pool/status", "", new URLSearchParams());
    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect((body.workers as Record<string, number>).active).toBe(1);
    const slots = body.slots as Array<Record<string, unknown>>;
    expect(slots).toHaveLength(1);
    expect(slots[0].discipline).toBe("engineering");
    expect(slots[0].status).toBe("working");
    expect(slots[0].currentEntityId).toBe("entity-abc");
  });
});
