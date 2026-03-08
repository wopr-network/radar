import { randomUUID } from "node:crypto";
import type { ClaimResponse, ReportResponse } from "../defcon/types.js";
import { extractRepoFromDescription } from "../sources/linear/repo-extractor.js";
import { safeErrorMessage } from "../sources/sanitize.js";
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

function isWorkClaim(claim: ClaimResponse): claim is Extract<ClaimResponse, { entity_id: string }> {
  return "entity_id" in claim;
}

export class RunLoop {
  private config: RunLoopConfig;
  private pollIntervalMs: number;
  private abortController: AbortController | null = null;
  private slotPromises: Map<string, Promise<void>> = new Map();
  private pendingClaims = 0;

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

    const timeout = this.config.stopTimeoutMs ?? 5000;
    const allSettled = Promise.allSettled(this.slotPromises.values());
    let timedOut = false;
    let forceTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const forceTimeout = new Promise<void>((resolve) => {
      forceTimeoutHandle = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeout);
    });

    await Promise.race([allSettled, forceTimeout]);
    clearTimeout(forceTimeoutHandle);

    if (!timedOut) {
      // Natural completion — all slots settled cleanly.
      await allSettled;
    }
    // Force-timeout path: slots are still running but aborted; null controller now
    // so this.signal getter returns a pre-aborted signal for any in-flight code.

    this.slotPromises.clear();
    this.abortController = null;
  }

  private get signal(): AbortSignal {
    if (!this.abortController) {
      // Controller was nulled after force-timeout; return a pre-aborted signal
      // so any in-flight slot coroutines see aborted=true and exit cleanly.
      const ac = new AbortController();
      ac.abort();
      return ac.signal;
    }
    return this.abortController.signal;
  }

  private async runSlot(slotId: string, workerId: string): Promise<void> {
    while (!this.signal.aborted) {
      try {
        await this.claimAndProcess(slotId, workerId);
      } catch (err) {
        if (!this.signal.aborted) {
          console.error(`[norad] slot ${slotId} claim error:`, safeErrorMessage(err));
          await sleep(this.pollIntervalMs, this.signal);
        }
      }
    }
  }

  private async claimAndProcess(slotId: string, workerId: string): Promise<void> {
    const { defcon, dispatcher, pool, role, flow } = this.config;

    // Concurrency gate: global per-flow limit
    // Use pendingClaims to prevent TOCTOU: multiple slots checking the count
    // before any of them completes a claim. pending + active must stay < maxConcurrent.
    if (flow != null && this.config.maxConcurrent != null) {
      const active = pool.activeCountByFlow(flow);
      if (active + this.pendingClaims >= this.config.maxConcurrent) {
        await sleep(this.pollIntervalMs, this.signal);
        return;
      }
    }

    this.pendingClaims++;
    let claim: ClaimResponse;
    try {
      claim = await defcon.claim({ workerId, role, flow }, { signal: this.signal });
    } finally {
      this.pendingClaims--;
    }

    if (!isWorkClaim(claim)) {
      await sleep(claim.retry_after_ms, this.signal);
      return;
    }

    const claimFlow = claim.flow;
    const claimRepo = extractRepoFromDescription(claim.prompt);

    // Concurrency gate: per-repo limit — checked BEFORE allocating a slot
    // so we skip rather than crash the entity
    if (claimFlow != null && claimRepo != null && this.config.maxConcurrentPerRepo != null) {
      const repoActive = pool.activeCountByRepo(claimFlow, claimRepo);
      if (repoActive >= this.config.maxConcurrentPerRepo) {
        try {
          await defcon.report({
            entityId: claim.entity_id,
            signal: "crash",
            artifacts: { error: `per-repo concurrency limit reached for ${claimRepo}` },
          });
        } catch (err) {
          console.error("[run-loop] crash report failed:", safeErrorMessage(err));
        }
        await sleep(this.pollIntervalMs, this.signal);
        return;
      }
    }

    const slot = pool.allocate(slotId, workerId, claim.entity_id, claim.prompt, claimFlow, claimRepo);
    if (!slot) {
      try {
        await defcon.report({
          entityId: claim.entity_id,
          signal: "crash",
          artifacts: { error: "slot unavailable" },
        });
      } catch {}
      await sleep(this.pollIntervalMs, this.signal);
      return;
    }

    try {
      const modelTier = "sonnet";
      let currentPrompt = claim.prompt;
      let currentSignal: string | undefined;
      let currentArtifacts: Record<string, unknown> | undefined;

      while (!this.signal.aborted) {
        if (currentSignal === undefined) {
          pool.setState(slotId, "working");
          const heartbeatInterval = setInterval(() => {
            pool.heartbeat(slotId);
          }, this.pollIntervalMs);
          try {
            const result = await dispatcher.dispatch(currentPrompt, {
              modelTier,
              workerId,
              entityId: claim.entity_id,
            });
            currentSignal = result.signal;
            currentArtifacts = result.artifacts;
          } catch (err) {
            currentSignal = "crash";
            currentArtifacts = { error: (err as Error).message };
          } finally {
            clearInterval(heartbeatInterval);
          }
        }

        pool.setState(slotId, "reporting");
        let response: ReportResponse;
        try {
          response = await defcon.report({
            entityId: claim.entity_id,
            signal: currentSignal,
            artifacts: currentArtifacts,
          });
        } catch (err) {
          if (!this.signal.aborted) {
            console.error(`[norad] slot ${slotId} report error:`, safeErrorMessage(err));
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
