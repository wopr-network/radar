import { describe, expect, it } from "vitest";
import { Pool } from "../src/pool/pool.js";

describe("Pool", () => {
  describe("availableSlots", () => {
    it("returns full capacity when empty", () => {
      const pool = new Pool(5);
      expect(pool.availableSlots()).toBe(5);
    });

    it("decrements when a slot is allocated", () => {
      const pool = new Pool(5);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "do the thing");
      expect(pool.availableSlots()).toBe(4);
    });

    it("returns 0 when at capacity", () => {
      const pool = new Pool(2);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt");
      pool.allocate("slot-2", "wkr-2", "engineering", "feat-2", "prompt");
      expect(pool.availableSlots()).toBe(0);
    });

    it("never returns negative even if somehow over-allocated", () => {
      const pool = new Pool(1);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt");
      // After capacity fix, next allocate returns null, so availableSlots stays >= 0
      expect(pool.availableSlots()).toBeGreaterThanOrEqual(0);
    });

    it("increments when a slot is released", () => {
      const pool = new Pool(2);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt");
      pool.release("slot-1");
      expect(pool.availableSlots()).toBe(2);
    });
  });

  describe("allocate", () => {
    it("returns a slot in claimed state", () => {
      const pool = new Pool(5);
      const slot = pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "do the thing");
      expect(slot.state).toBe("claimed");
      expect(slot.slotId).toBe("slot-1");
      expect(slot.workerId).toBe("wkr-1");
      expect(slot.entityId).toBe("feat-1");
      expect(slot.prompt).toBe("do the thing");
      expect(slot.result).toBeNull();
    });

    it("throws if slotId already allocated", () => {
      const pool = new Pool(5);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt");
      expect(() => pool.allocate("slot-1", "wkr-2", "engineering", "feat-2", "prompt")).toThrow();
    });

    it("returns null when at capacity", () => {
      const pool = new Pool(2);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt");
      pool.allocate("slot-2", "wkr-2", "engineering", "feat-2", "prompt");
      const result = pool.allocate("slot-3", "wkr-3", "engineering", "feat-3", "prompt");
      expect(result).toBeNull();
    });

    it("allocating up to capacity succeeds", () => {
      const pool = new Pool(3);
      expect(pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt")).not.toBeNull();
      expect(pool.allocate("slot-2", "wkr-2", "engineering", "feat-2", "prompt")).not.toBeNull();
      expect(pool.allocate("slot-3", "wkr-3", "engineering", "feat-3", "prompt")).not.toBeNull();
    });
  });

  describe("complete", () => {
    it("sets result and state to reporting", () => {
      const pool = new Pool(5);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt");
      pool.complete("slot-1", { signal: "pr_created", artifacts: { prUrl: "https://github.com/..." } });
      const slots = pool.activeSlots();
      expect(slots[0].state).toBe("reporting");
      expect(slots[0].result?.signal).toBe("pr_created");
    });

    it("throws on unknown slot", () => {
      const pool = new Pool(5);
      expect(() => pool.complete("nope", { signal: "x", artifacts: {} })).toThrow();
    });
  });

  describe("release", () => {
    it("removes the slot", () => {
      const pool = new Pool(5);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt");
      pool.release("slot-1");
      expect(pool.activeSlots()).toHaveLength(0);
    });

    it("throws on unknown slot", () => {
      const pool = new Pool(5);
      expect(() => pool.release("nope")).toThrow();
    });
  });

  describe("setState", () => {
    it("updates slot state", () => {
      const pool = new Pool(5);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt");
      pool.setState("slot-1", "working");
      expect(pool.activeSlots()[0].state).toBe("working");
    });
  });

  describe("activeSlots", () => {
    it("returns all allocated slots", () => {
      const pool = new Pool(5);
      pool.allocate("slot-1", "wkr-1", "engineering", "feat-1", "prompt");
      pool.allocate("slot-2", "wkr-2", "engineering", "feat-2", "prompt");
      expect(pool.activeSlots()).toHaveLength(2);
    });
  });
});
