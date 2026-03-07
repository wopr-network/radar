import { randomUUID } from "node:crypto";
import type { ClaimResponse, ReportResponse } from "../defcon/types.js";
import type { RunLoopConfig } from "./types.js";

const DEFAULT_POLL_INTERVAL_MS = 5000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const handler = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", handler);
      resolve();
    }, ms);
    signal?.addEventListener("abort", handler, { once: true });
  });
}

function isWorkClaim(claim: ClaimResponse): claim is Extract<ClaimResponse, { entityId: string }> {
  return "entityId" in claim;
}

export class RunLoop {
  private config: RunLoopConfig;
  private pollIntervalMs: number;
  private abortController: AbortController | null = null;
  private slotPromises: Map<string, Promise<void>> = new Map();

  constructor(config: RunLoopConfig) {
    this.config = config;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  start(): void {
    if (this.abortController) throw new Error("RunLoop already started");
    this.abortController = new AbortController();
    const { pool } = this.config;

    const capacity = pool.availableSlots();
    for (let i = 0; i < capacity; i++) {
      const slotId = `slot-${i}`;
      const workerId = `${this.config.workerIdPrefix ?? "wkr"}-${randomUUID().slice(0, 8)}`;
      const promise = this.runSlot(slotId, workerId);
      this.slotPromises.set(slotId, promise);
    }
  }

  async stop(): Promise<void> {
    if (!this.abortController) return;
    this.abortController.abort();
    await Promise.allSettled(this.slotPromises.values());
    this.slotPromises.clear();
    this.abortController = null;
  }

  private get signal(): AbortSignal {
    if (!this.abortController) throw new Error("RunLoop is not running");
    return this.abortController.signal;
  }

  private async runSlot(slotId: string, workerId: string): Promise<void> {
    while (!this.signal.aborted) {
      try {
        await this.claimAndProcess(slotId, workerId);
      } catch (err) {
        if (!this.signal.aborted) {
          console.error(`[norad] slot ${slotId} claim error:`, (err as Error).message);
          await sleep(this.pollIntervalMs, this.signal);
        }
      }
    }
  }

  private extractRepoFromPrompt(prompt: string): string | null {
    const match = prompt.match(/\b([a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+)\b/);
    return match ? match[1] : null;
  }

  private async claimAndProcess(slotId: string, workerId: string): Promise<void> {
    const { defcon, dispatcher, pool, role, flow } = this.config;

    // Concurrency gate: global per-flow limit
    if (flow != null && this.config.maxConcurrent != null) {
      const active = pool.activeCountByFlow(flow);
      if (active >= this.config.maxConcurrent) {
        await sleep(this.pollIntervalMs, this.signal);
        return;
      }
    }

    const claim = await defcon.claim({ workerId, role, flow });

    if (!isWorkClaim(claim)) {
      await sleep(claim.retry_after_ms, this.signal);
      return;
    }

    const claimFlow = claim.flow ?? flow ?? null;
    const claimRepo = this.extractRepoFromPrompt(claim.prompt);

    // Concurrency gate: per-repo limit
    if (claimFlow != null && claimRepo != null && this.config.maxConcurrentPerRepo != null) {
      const repoActive = pool.activeCountByRepo(claimFlow, claimRepo);
      if (repoActive >= this.config.maxConcurrentPerRepo) {
        try {
          await defcon.report({
            workerId,
            entityId: claim.entityId,
            signal: "crash",
            artifacts: { error: `per-repo concurrency limit reached for ${claimRepo}` },
          });
        } catch {}
        await sleep(this.pollIntervalMs, this.signal);
        return;
      }
    }

    const slot = pool.allocate(slotId, workerId, claim.entityId, claim.prompt, claimFlow, claimRepo);
    if (!slot) {
      try {
        await defcon.report({
          workerId,
          entityId: claim.entityId,
          signal: "crash",
          artifacts: { error: "slot unavailable" },
        });
      } catch {}
      await sleep(this.pollIntervalMs, this.signal);
      return;
    }

    try {
      const modelTier = claim.modelTier ?? "sonnet";
      let currentPrompt = claim.prompt;
      let currentSignal: string | undefined;
      let currentArtifacts: Record<string, unknown> | undefined;

      while (!this.signal.aborted) {
        if (currentSignal === undefined) {
          pool.setState(slotId, "working");
          try {
            const result = await dispatcher.dispatch(currentPrompt, {
              modelTier,
              workerId,
              entityId: claim.entityId,
            });
            currentSignal = result.signal;
            currentArtifacts = result.artifacts;
          } catch (err) {
            currentSignal = "crash";
            currentArtifacts = { error: (err as Error).message };
          }
        }

        pool.setState(slotId, "reporting");
        let response: ReportResponse;
        try {
          response = await defcon.report({
            workerId,
            entityId: claim.entityId,
            signal: currentSignal,
            artifacts: currentArtifacts,
          });
        } catch (err) {
          if (!this.signal.aborted) {
            console.error(`[norad] slot ${slotId} report error:`, (err as Error).message);
            await sleep(this.pollIntervalMs, this.signal);
            continue;
          }
          break;
        }

        if (response.next_action === "continue") {
          currentPrompt = response.prompt;
          currentSignal = undefined;
          currentArtifacts = undefined;
          continue;
        }

        if (response.next_action === "check_back") {
          await sleep(response.retry_after_ms, this.signal);
          continue;
        }

        // "waiting" — release slot
        break;
      }
    } finally {
      try {
        pool.release(slotId);
      } catch {
        // slot may not be allocated if early error
      }
    }
  }
}
