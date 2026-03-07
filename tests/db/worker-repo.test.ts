import { beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../../src/db/index.js";
import type { NoradDb } from "../../src/db/index.js";
import { WorkerRepo } from "../../src/db/repos/worker-repo.js";

describe("WorkerRepo", () => {
  let db: NoradDb;
  let repo: WorkerRepo;

  beforeEach(() => {
    db = applySchema(":memory:");
    repo = new WorkerRepo(db);
  });

  it("registers a worker", () => {
    const w = repo.register({ name: "wopr-1", type: "wopr", discipline: "engineering" });
    expect(w.name).toBe("wopr-1");
    expect(w.status).toBe("idle");
    expect(w.type).toBe("wopr");
  });

  it("registers a worker with config", () => {
    const w = repo.register({ name: "claude-1", type: "claude", discipline: "qa", config: { model: "opus" } });
    expect(w.config).toEqual({ model: "opus" });
  });

  it("deregisters a worker", () => {
    const w = repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    repo.deregister(w.id);
    expect(repo.getById(w.id)).toBeUndefined();
  });

  it("updates heartbeat", () => {
    const w = repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    const before = w.lastHeartbeat;
    repo.heartbeat(w.id);
    const after = repo.getById(w.id);
    expect(after).toBeDefined();
    expect(after?.lastHeartbeat).toBeGreaterThanOrEqual(before);
  });

  it("sets status", () => {
    const w = repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    repo.setStatus(w.id, "working");
    const updated = repo.getById(w.id);
    expect(updated?.status).toBe("working");
  });

  it("sets status to offline", () => {
    const w = repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    repo.setStatus(w.id, "offline");
    expect(repo.getById(w.id)?.status).toBe("offline");
  });

  it("lists all workers", () => {
    repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    repo.register({ name: "w2", type: "claude", discipline: "qa" });
    expect(repo.list()).toHaveLength(2);
  });

  it("lists workers by status", () => {
    const w1 = repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    repo.register({ name: "w2", type: "claude", discipline: "qa" });
    repo.setStatus(w1.id, "working");
    const idle = repo.listByStatus("idle");
    expect(idle).toHaveLength(1);
    expect(idle[0].name).toBe("w2");
  });

  it("throws on heartbeat for unknown worker", () => {
    expect(() => repo.heartbeat("nonexistent")).toThrow();
  });
});
