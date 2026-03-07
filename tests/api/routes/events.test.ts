import { beforeEach, describe, expect, it } from "vitest";
import { Router } from "../../../src/api/router.js";
import { registerEventRoutes } from "../../../src/api/routes/events.js";
import type { EventLogEntry, EventLogRepo } from "../../../src/api/types.js";

function makeEventLogRepo(): EventLogRepo {
  const entries: EventLogEntry[] = [];
  return {
    async findAll(opts) {
      const start = opts?.offset ?? 0;
      const end = start + (opts?.limit ?? 50);
      return entries.slice(start, end);
    },
    async append(data) {
      const entry: EventLogEntry = { id: crypto.randomUUID(), ...data, created_at: Date.now() };
      entries.push(entry);
      return entry;
    },
  };
}

describe("Event Routes", () => {
  let router: Router;
  let repo: EventLogRepo;

  beforeEach(() => {
    router = new Router();
    repo = makeEventLogRepo();
    registerEventRoutes(router, repo);
  });

  it("GET /api/events returns event log", async () => {
    await repo.append({ source_id: "s1", watch_id: null, raw_event: {}, action_taken: null, defcon_response: null });
    const result = await router.handle("GET", "/api/events", "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect((result.body as EventLogEntry[]).length).toBe(1);
  });

  it("GET /api/events respects limit query param", async () => {
    await repo.append({ source_id: "s1", watch_id: null, raw_event: {}, action_taken: null, defcon_response: null });
    await repo.append({ source_id: "s2", watch_id: null, raw_event: {}, action_taken: null, defcon_response: null });
    const result = await router.handle("GET", "/api/events", "", new URLSearchParams("limit=1"));
    expect(result.status).toBe(200);
    expect((result.body as EventLogEntry[]).length).toBe(1);
  });
});
