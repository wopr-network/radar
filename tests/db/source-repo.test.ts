import { beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../../src/db/index.js";
import type { NoradDb } from "../../src/db/index.js";
import { SourceRepo } from "../../src/db/repos/source-repo.js";

describe("SourceRepo", () => {
  let db: NoradDb;
  let repo: SourceRepo;

  beforeEach(() => {
    db = applySchema(":memory:");
    repo = new SourceRepo(db);
  });

  it("creates and retrieves a source", () => {
    const src = repo.create({ name: "linear-prod", type: "webhook", config: { secret: "abc" } });
    expect(src.name).toBe("linear-prod");
    expect(src.type).toBe("webhook");
    expect(src.enabled).toBe(true);

    const found = repo.getById(src.id);
    expect(found).toBeDefined();
    expect(found?.name).toBe("linear-prod");
  });

  it("lists all sources", () => {
    repo.create({ name: "s1", type: "poll", config: {} });
    repo.create({ name: "s2", type: "cron", config: {} });
    const all = repo.list();
    expect(all).toHaveLength(2);
  });

  it("updates a source", () => {
    const src = repo.create({ name: "s1", type: "poll", config: {} });
    const updated = repo.update(src.id, { name: "s1-renamed", enabled: false });
    expect(updated?.name).toBe("s1-renamed");
    expect(updated?.enabled).toBe(false);
  });

  it("deletes a source", () => {
    const src = repo.create({ name: "s1", type: "poll", config: {} });
    repo.delete(src.id);
    expect(repo.getById(src.id)).toBeUndefined();
  });

  it("enforces unique name", () => {
    repo.create({ name: "dup", type: "poll", config: {} });
    expect(() => repo.create({ name: "dup", type: "poll", config: {} })).toThrow();
  });

  it("getByName returns the source", () => {
    repo.create({ name: "by-name", type: "webhook", config: { url: "x" } });
    const found = repo.getByName("by-name");
    expect(found?.type).toBe("webhook");
  });
});
