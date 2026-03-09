import { beforeEach, describe, expect, it } from "vitest";
import { applySchema } from "../../src/db/index.js";
import type { RadarDb } from "../../src/db/index.js";
import { WorkerRepo } from "../../src/db/repos/worker-repo.js";

describe("WorkerRepo", () => {
  let db: RadarDb;
  let repo: WorkerRepo;

  beforeEach(() => {
    db = applySchema(":memory:");
    repo = new WorkerRepo(db);
  });

  it("registers a worker", async () => {
    const w = await repo.register({ name: "wopr-1", type: "wopr", discipline: "engineering" });
    expect(w.name).toBe("wopr-1");
    expect(w.status).toBe("idle");
    expect(w.type).toBe("wopr");
  });

  it("registers a worker with config", async () => {
    const w = await repo.register({ name: "claude-1", type: "claude", discipline: "qa", config: { model: "opus" } });
    expect(w.config).toEqual({ model: "opus" });
  });

  it("deregisters a worker", async () => {
    const w = await repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    await repo.deregister(w.id);
    expect(await repo.getById(w.id)).toBeUndefined();
  });

  it("updates heartbeat", async () => {
    const w = await repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    const before = w.lastHeartbeat;
    await repo.heartbeat(w.id);
    const after = await repo.getById(w.id);
    expect(after).toBeDefined();
    expect(after?.lastHeartbeat).toBeGreaterThanOrEqual(before);
  });

  it("sets status", async () => {
    const w = await repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    await repo.setStatus(w.id, "working");
    const updated = await repo.getById(w.id);
    expect(updated?.status).toBe("working");
  });

  it("sets status to offline", async () => {
    const w = await repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    await repo.setStatus(w.id, "offline");
    expect((await repo.getById(w.id))?.status).toBe("offline");
  });

  it("lists all workers", async () => {
    await repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    await repo.register({ name: "w2", type: "claude", discipline: "qa" });
    expect(await repo.list()).toHaveLength(2);
  });

  it("lists workers by status", async () => {
    const w1 = await repo.register({ name: "w1", type: "wopr", discipline: "engineering" });
    await repo.register({ name: "w2", type: "claude", discipline: "qa" });
    await repo.setStatus(w1.id, "working");
    const idle = await repo.listByStatus("idle");
    expect(idle).toHaveLength(1);
    expect(idle[0].name).toBe("w2");
  });

  it("throws on heartbeat for unknown worker", async () => {
    await expect(repo.heartbeat("nonexistent")).rejects.toThrow();
  });
});
