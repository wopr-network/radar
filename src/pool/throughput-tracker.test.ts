import { describe, expect, it } from "vitest";
import { ThroughputTracker } from "./throughput-tracker.js";

describe("ThroughputTracker", () => {
  it("returns zeros when empty", () => {
    const t = new ThroughputTracker();
    const stats = t.getStats();
    expect(stats.completed_last_hour).toBe(0);
    expect(stats.failed_last_hour).toBe(0);
    expect(stats.avg_duration_ms).toBe(0);
  });

  it("counts completed and failed separately", () => {
    const t = new ThroughputTracker();
    t.record("completed", 1000);
    t.record("completed", 2000);
    t.record("failed", 500);
    const stats = t.getStats();
    expect(stats.completed_last_hour).toBe(2);
    expect(stats.failed_last_hour).toBe(1);
    expect(stats.avg_duration_ms).toBe(1500); // avg of completed only
  });

  it("excludes entries older than 1 hour", () => {
    const t = new ThroughputTracker();
    const now = Date.now();
    t.recordAt("completed", 1000, now - 3_700_000); // older than 1h
    t.record("completed", 2000);
    const stats = t.getStats();
    expect(stats.completed_last_hour).toBe(1);
  });

  it("avg_duration_ms only counts completed, not failed", () => {
    const t = new ThroughputTracker();
    t.record("failed", 9999);
    t.record("completed", 500);
    const stats = t.getStats();
    expect(stats.avg_duration_ms).toBe(500);
  });
});
