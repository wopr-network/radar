import { describe, expect, it } from "vitest";
import { createDb } from "../index.js";
import { DrizzleEntityActivityRepo } from "./drizzle-entity-activity-repo.js";

function makeRepo() {
  return new DrizzleEntityActivityRepo(createDb());
}

describe("EntityActivityRepo", () => {
  describe("insert", () => {
    it("stores and returns the row with auto seq=0 for first insert", () => {
      const repo = makeRepo();
      const row = repo.insert({
        entityId: "e1",
        slotId: "slot-1",
        type: "tool_use",
        data: { name: "Read", input: { file_path: "/foo.ts" } },
      });
      expect(row.entityId).toBe("e1");
      expect(row.slotId).toBe("slot-1");
      expect(row.seq).toBe(0);
      expect(row.type).toBe("tool_use");
      expect(row.data).toEqual({ name: "Read", input: { file_path: "/foo.ts" } });
      expect(row.id).toBeTruthy();
      expect(row.createdAt).toBeGreaterThan(0);
    });

    it("auto-increments seq per entity", () => {
      const repo = makeRepo();
      const r0 = repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      const r1 = repo.insert({ entityId: "e1", slotId: "s1", type: "tool_use", data: {} });
      const r2 = repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      expect(r0.seq).toBe(0);
      expect(r1.seq).toBe(1);
      expect(r2.seq).toBe(2);
    });

    it("seq is scoped per entity", () => {
      const repo = makeRepo();
      repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      const r = repo.insert({ entityId: "e2", slotId: "s2", type: "start", data: {} });
      expect(r.seq).toBe(0);
    });
  });

  describe("getByEntity", () => {
    it("returns rows in seq order", () => {
      const repo = makeRepo();
      repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      repo.insert({ entityId: "e1", slotId: "s1", type: "tool_use", data: {} });
      const rows = repo.getByEntity("e1");
      expect(rows.map((r) => r.seq)).toEqual([0, 1, 2]);
    });

    it("filters by since (exclusive)", () => {
      const repo = makeRepo();
      for (let i = 0; i < 5; i++) {
        repo.insert({ entityId: "e1", slotId: "s1", type: "text", data: { text: `line ${i}` } });
      }
      const rows = repo.getByEntity("e1", 2);
      expect(rows.map((r) => r.seq)).toEqual([3, 4]);
    });

    it("returns empty array for unknown entity", () => {
      const repo = makeRepo();
      expect(repo.getByEntity("nobody")).toEqual([]);
    });
  });

  describe("getSummary", () => {
    it("returns empty string when no activity", () => {
      const repo = makeRepo();
      expect(repo.getSummary("e1")).toBe("");
    });

    it("includes tool_use events", () => {
      const repo = makeRepo();
      repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      repo.insert({
        entityId: "e1",
        slotId: "s1",
        type: "tool_use",
        data: { name: "Read", input: { file_path: "/src/foo.ts" } },
      });
      repo.insert({
        entityId: "e1",
        slotId: "s1",
        type: "result",
        data: { subtype: "success", cost_usd: 0.001 },
      });
      const summary = repo.getSummary("e1");
      expect(summary).toContain("Called tool: Read");
      expect(summary).toContain("Ended: success");
    });

    it("groups by slotId as separate attempts", () => {
      const repo = makeRepo();
      repo.insert({ entityId: "e1", slotId: "slot-a", type: "start", data: {} });
      repo.insert({ entityId: "e1", slotId: "slot-a", type: "result", data: { subtype: "error" } });
      repo.insert({ entityId: "e1", slotId: "slot-b", type: "start", data: {} });
      repo.insert({ entityId: "e1", slotId: "slot-b", type: "result", data: { subtype: "success" } });
      const summary = repo.getSummary("e1");
      expect(summary).toContain("Attempt 1:");
      expect(summary).toContain("Attempt 2:");
    });

    it("includes prose wrapping", () => {
      const repo = makeRepo();
      repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      const summary = repo.getSummary("e1");
      expect(summary).toContain("Prior work on this entity:");
      expect(summary).toContain("pick up where the last attempt left off");
    });
  });

  describe("deleteByEntity", () => {
    it("removes all rows for entity", () => {
      const repo = makeRepo();
      repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      repo.insert({ entityId: "e1", slotId: "s1", type: "result", data: {} });
      repo.deleteByEntity("e1");
      expect(repo.getByEntity("e1")).toEqual([]);
    });

    it("does not affect other entities", () => {
      const repo = makeRepo();
      repo.insert({ entityId: "e1", slotId: "s1", type: "start", data: {} });
      repo.insert({ entityId: "e2", slotId: "s2", type: "start", data: {} });
      repo.deleteByEntity("e1");
      expect(repo.getByEntity("e2")).toHaveLength(1);
    });
  });
});
