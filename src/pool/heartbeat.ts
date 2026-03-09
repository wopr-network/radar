import type { WorkerRepo } from "../db/repos/worker-repo.js";
import { logger } from "../logger.js";

export interface HeartbeatReaperConfig {
  /** How old a heartbeat must be (in seconds) before the worker is considered dead. Default: 60 */
  staleThresholdSec: number;
  /** How often to check for stale workers (in milliseconds). Default: 15000 */
  checkIntervalMs: number;
}

export const DEFAULT_HEARTBEAT_REAPER_CONFIG: HeartbeatReaperConfig = {
  staleThresholdSec: 60,
  checkIntervalMs: 15_000,
};

export class HeartbeatReaper {
  private repo: WorkerRepo;
  private config: HeartbeatReaperConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;

  constructor(repo: WorkerRepo, config: HeartbeatReaperConfig) {
    this.repo = repo;
    this.config = config;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.checking) return;
      this.checking = true;
      try {
        this.reap();
      } finally {
        this.checking = false;
      }
    }, this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private reap(): void {
    const cutoff = Math.floor(Date.now() / 1000) - this.config.staleThresholdSec;
    const stale = this.repo.findStale(cutoff);

    for (const worker of stale) {
      try {
        void this.repo.setStatus(worker.id, "offline");
        logger.warn("[heartbeat-reaper] worker marked offline", {
          workerId: worker.id,
          name: worker.name,
          lastHeartbeat: worker.lastHeartbeat,
        });
      } catch (err) {
        logger.error("[heartbeat-reaper] failed to mark worker offline", {
          workerId: worker.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}
