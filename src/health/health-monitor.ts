import type { DefconClient } from "../defcon/client.js";
import type { Pool } from "../pool/pool.js";
import type { HealthMonitorConfig } from "./types.js";

export class HealthMonitor {
  private pool: Pool;
  private defcon: DefconClient;
  private config: HealthMonitorConfig;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(pool: Pool, defcon: DefconClient, config: HealthMonitorConfig) {
    this.pool = pool;
    this.defcon = defcon;
    this.config = config;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.check();
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
        } catch {
          // Log but don't crash — slot still gets released
        }
      }

      try {
        this.pool.release(slot.slotId);
      } catch {
        // Slot may have been released concurrently
      }
    }
  }
}
