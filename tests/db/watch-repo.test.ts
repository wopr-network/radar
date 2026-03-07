import { beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../../src/db/index.js";
import type { NoradDb } from "../../src/db/index.js";
import { SourceRepo } from "../../src/db/repos/source-repo.js";
import { WatchRepo } from "../../src/db/repos/watch-repo.js";

describe("WatchRepo", () => {
  let db: NoradDb;
  let watchRepo: WatchRepo;
  let sourceId: string;

  beforeEach(() => {
    db = applySchema(":memory:");
    const sourceRepo = new SourceRepo(db);
    const src = sourceRepo.create({ name: "test-source", type: "webhook", config: {} });
    sourceId = src.id;
    watchRepo = new WatchRepo(db);
  });

  it("creates and retrieves a watch", () => {
    const w = watchRepo.create({
      sourceId,
      name: "new-issue",
      filter: { type: "Issue" },
      action: "create_entity",
      actionConfig: { flow: "engineering" },
    });
    expect(w.name).toBe("new-issue");
    expect(w.action).toBe("create_entity");

    const found = watchRepo.getById(w.id);
    expect(found).toBeDefined();
    expect(found?.sourceId).toBe(sourceId);
  });

  it("lists watches by source", () => {
    watchRepo.create({ sourceId, name: "w1", filter: {}, action: "create_entity", actionConfig: {} });
    watchRepo.create({ sourceId, name: "w2", filter: {}, action: "report_signal", actionConfig: {} });
    const bySource = watchRepo.listBySource(sourceId);
    expect(bySource).toHaveLength(2);
  });

  it("updates a watch", () => {
    const w = watchRepo.create({ sourceId, name: "w1", filter: {}, action: "create_entity", actionConfig: {} });
    const updated = watchRepo.update(w.id, { enabled: false, name: "w1-updated" });
    expect(updated?.enabled).toBe(false);
    expect(updated?.name).toBe("w1-updated");
  });

  it("deletes a watch", () => {
    const w = watchRepo.create({ sourceId, name: "w1", filter: {}, action: "create_entity", actionConfig: {} });
    watchRepo.delete(w.id);
    expect(watchRepo.getById(w.id)).toBeUndefined();
  });
});
