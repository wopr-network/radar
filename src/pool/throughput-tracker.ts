interface ThroughputEntry {
  timestamp: number;
  outcome: "completed" | "failed";
  durationMs: number;
}

const ONE_HOUR_MS = 3_600_000;

export class ThroughputTracker {
  private entries: ThroughputEntry[] = [];

  record(outcome: "completed" | "failed", durationMs: number): void {
    this.entries.push({ timestamp: Date.now(), outcome, durationMs });
  }

  /** For testing — record with explicit timestamp */
  recordAt(outcome: "completed" | "failed", durationMs: number, timestamp: number): void {
    this.entries.push({ timestamp, outcome, durationMs });
  }

  getStats(): { completed_last_hour: number; failed_last_hour: number; avg_duration_ms: number } {
    const cutoff = Date.now() - ONE_HOUR_MS;
    this.entries = this.entries.filter((e) => e.timestamp >= cutoff);

    let completed = 0;
    let failed = 0;
    let totalDuration = 0;

    for (const entry of this.entries) {
      if (entry.outcome === "completed") {
        completed++;
        totalDuration += entry.durationMs;
      } else {
        failed++;
      }
    }

    return {
      completed_last_hour: completed,
      failed_last_hour: failed,
      avg_duration_ms: completed > 0 ? Math.round(totalDuration / completed) : 0,
    };
  }
}
