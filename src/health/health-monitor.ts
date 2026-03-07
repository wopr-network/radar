import type { DefconClient } from "../defcon/client.js";
import type { Pool } from "../pool/pool.js";
import type { HealthMonitorConfig } from "./types.js";

export class HealthMonitor {
  private pool: Pool;
  private defcon: DefconClient;
  private config: HealthMonitorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;

  constructor(pool: Pool, defcon: DefconClient, config: HealthMonitorConfig) {
    this.pool = pool;
    this.defcon = defcon;
    this.config = config;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.checking) return;
      this.checking = true;
      this.check().finally(() => {
        this.checking = false;
      });
    }, this.config.heartbeatIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async check(): Promise<void> {
    const now = Date.now();
    const slots = this.pool.activeSlots();

    for (const slot of slots) {
      if (slot.state === "reporting") continue;
      if (now - slot.lastHeartbeat <= this.config.deadWorkerThresholdMs) continue;

      if (slot.entityId) {
        try {
          await this.defcon.report({
            workerId: slot.workerId,
            entityId: slot.entityId,
            signal: "fail",
            artifacts: { reason: "worker_timeout" },
          });
        } catch (err) {
          console.error("[HealthMonitor] Error reporting dead slot:", err);
        }
      }

      // Re-check staleness: heartbeat may have arrived during the await above.
      // If so, the slot is alive — skip release.
      if (Date.now() - slot.lastHeartbeat <= this.config.deadWorkerThresholdMs) {
        continue;
      }

      try {
        this.pool.release(slot.slotId);
      } catch (err) {
        console.error("[HealthMonitor] Error releasing slot:", err);
      }
    }
  }
}
