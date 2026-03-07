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
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
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

    const capacity = pool.availableSlots() + pool.activeSlots().length;
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
    return this.abortController?.signal as AbortSignal;
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

  private async claimAndProcess(slotId: string, workerId: string): Promise<void> {
    const { defcon, dispatcher, pool, role, flow } = this.config;

    const claim = await defcon.claim({ workerId, role, flow });

    if (!isWorkClaim(claim)) {
      await sleep(claim.retry_after_ms, this.signal);
      return;
    }

    const slot = pool.allocate(slotId, workerId, claim.entityId, claim.prompt);
    if (!slot) {
      await sleep(this.pollIntervalMs, this.signal);
      return;
    }

    try {
      const modelTier = (claim as { modelTier?: "opus" | "sonnet" | "haiku" }).modelTier ?? "sonnet";
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
