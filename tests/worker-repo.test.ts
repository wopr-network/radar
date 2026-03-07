import { describe, expect, it } from "vitest";
import { InMemoryWorkerRepo } from "../src/worker/worker-repo.js";

describe("InMemoryWorkerRepo", () => {
  describe("create", () => {
    it("creates a worker with wkr_ prefixed id", () => {
      const repo = new InMemoryWorkerRepo();
      const worker = repo.create({ type: "coder", discipline: "engineering" });
      expect(worker.id).toMatch(/^wkr_[a-f0-9]{12}$/);
      expect(worker.name).toMatch(/^auto-[a-f0-9]{8}$/);
      expect(worker.type).toBe("coder");
      expect(worker.discipline).toBe("engineering");
      expect(worker.status).toBe("idle");
      expect(worker.createdAt).toBeInstanceOf(Date);
      expect(worker.lastActivityAt).toBeInstanceOf(Date);
    });

    it("defaults type to unknown and discipline to null", () => {
      const repo = new InMemoryWorkerRepo();
      const worker = repo.create({});
      expect(worker.type).toBe("unknown");
      expect(worker.discipline).toBeNull();
    });
  });

  describe("get", () => {
    it("returns worker by id", () => {
      const repo = new InMemoryWorkerRepo();
      const created = repo.create({ type: "tester" });
      const found = repo.get(created.id);
      expect(found).toEqual(created);
    });

    it("returns undefined for unknown id", () => {
      const repo = new InMemoryWorkerRepo();
      expect(repo.get("wkr_doesnotexist")).toBeUndefined();
    });
  });

  describe("touch", () => {
    it("updates lastActivityAt", async () => {
      const repo = new InMemoryWorkerRepo();
      const worker = repo.create({ type: "coder" });
      const before = worker.lastActivityAt;
      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 5));
      repo.touch(worker.id);
      const updated = repo.get(worker.id)!;
      expect(updated.lastActivityAt.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe("list", () => {
    it("returns all workers", () => {
      const repo = new InMemoryWorkerRepo();
      repo.create({ type: "a" });
      repo.create({ type: "b" });
      expect(repo.list()).toHaveLength(2);
    });
  });
});
