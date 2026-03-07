import { beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../../src/db/index.js";
import type { NoradDb } from "../../src/db/index.js";
import { EventLogRepo } from "../../src/db/repos/event-log-repo.js";
import { SourceRepo } from "../../src/db/repos/source-repo.js";
import { WatchRepo } from "../../src/db/repos/watch-repo.js";

describe("EventLogRepo", () => {
  let db: NoradDb;
  let repo: EventLogRepo;
  let sourceId: string;
  let watchId: string;

  beforeEach(() => {
    db = applySchema(":memory:");
    const sourceRepo = new SourceRepo(db);
    const src = sourceRepo.create({ name: "test-src", type: "webhook", config: {} });
    sourceId = src.id;
    const watchRepo = new WatchRepo(db);
    const w = watchRepo.create({ sourceId, name: "w1", filter: {}, action: "create_entity", actionConfig: {} });
    watchId = w.id;
    repo = new EventLogRepo(db);
  });

  it("appends an event and retrieves it", () => {
    const evt = repo.append({
      sourceId,
      watchId,
      rawEvent: { type: "Issue", action: "create" },
      actionTaken: "create_entity",
      defconResponse: { entityId: "e1" },
    });
    expect(evt.id).toBeDefined();
    expect(evt.actionTaken).toBe("create_entity");

    const found = repo.getById(evt.id);
    expect(found).toBeDefined();
    expect(found?.rawEvent).toEqual({ type: "Issue", action: "create" });
  });

  it("appends event with null watch_id", () => {
    const evt = repo.append({
      sourceId,
      watchId: null,
      rawEvent: { unmatched: true },
      actionTaken: null,
      defconResponse: null,
    });
    expect(evt.watchId).toBeNull();
    expect(evt.actionTaken).toBeNull();
  });

  it("queries by source", () => {
    repo.append({ sourceId, watchId: null, rawEvent: { a: 1 }, actionTaken: null, defconResponse: null });
    repo.append({ sourceId, watchId: null, rawEvent: { a: 2 }, actionTaken: null, defconResponse: null });
    const results = repo.queryBySource(sourceId);
    expect(results).toHaveLength(2);
  });

  it("queries with limit", () => {
    for (let i = 0; i < 5; i++) {
      repo.append({ sourceId, watchId: null, rawEvent: { i }, actionTaken: null, defconResponse: null });
    }
    const results = repo.queryBySource(sourceId, { limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("queries by watch", () => {
    repo.append({ sourceId, watchId, rawEvent: { matched: true }, actionTaken: "create_entity", defconResponse: null });
    repo.append({ sourceId, watchId: null, rawEvent: { unmatched: true }, actionTaken: null, defconResponse: null });
    const results = repo.queryByWatch(watchId);
    expect(results).toHaveLength(1);
    expect(results[0].watchId).toBe(watchId);
  });
});
