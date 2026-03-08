import { describe, expect, it, vi } from "vitest";
import type { DefconClient } from "../../src/defcon/client.js";
import type { ClaimResponse, ReportResponse } from "../../src/defcon/types.js";
import type { Dispatcher, DispatchOpts, WorkerResult } from "../../src/dispatcher/types.js";
import { Pool } from "../../src/pool/pool.js";
import { RunLoop } from "../../src/run-loop/run-loop.js";

function createMockDefcon(overrides?: {
  claim?: () => Promise<ClaimResponse>;
  report?: () => Promise<ReportResponse>;
}) {
  return {
    claim: overrides?.claim ?? vi.fn<() => Promise<ClaimResponse>>(),
    report: overrides?.report ?? vi.fn<() => Promise<ReportResponse>>(),
    createEntity: vi.fn(),
  } as unknown as DefconClient;
}

function createEchoDispatcher(): Dispatcher {
  return {
    dispatch: vi.fn(async (prompt: string, _opts: DispatchOpts): Promise<WorkerResult> => ({
      signal: "done",
      artifacts: { echo: prompt },
      exitCode: 0,
    })),
  };
}

describe("RunLoop", () => {
  it("claims, dispatches, reports, then releases on waiting", async () => {
    let claimCount = 0;
    const mockDefcon = createMockDefcon({
      claim: vi.fn(async () => {
        claimCount++;
        if (claimCount === 1) {
          return {
            
            entity_id: "ent-1",
            invocation_id: "inv-1",
            flow: "test-flow",
            stage: "do-work",
            prompt: "Hello world",
          } satisfies ClaimResponse;
        }
        return {
          next_action: "check_back" as const,
          retry_after_ms: 60000,
          message: "No work",
        };
      }),
      report: vi.fn(async () => ({
        next_action: "waiting" as const,
        gated: true as const,
        gateName: "review",
        gate_output: "needs review",
      })),
    });

    const dispatcher = createEchoDispatcher();
    const pool = new Pool(2);

    const loop = new RunLoop({
      pool,
      defcon: mockDefcon,
      dispatcher,
      role: "engineering",
      pollIntervalMs: 10,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 200));
    await loop.stop();

    expect(mockDefcon.claim).toHaveBeenCalled();
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      "Hello world",
      expect.objectContaining({
        modelTier: "sonnet",
        workerId: expect.stringContaining("wkr-"),
        entityId: "ent-1",
      }),
    );
    expect(mockDefcon.report).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "ent-1",
        signal: "done",
        artifacts: { echo: "Hello world" },
      }),
    );
    expect(pool.activeSlots()).toHaveLength(0);
  });

  it("handles continue response by dispatching again", async () => {
    let reportCount = 0;
    let claimCount = 0;
    const mockDefcon = createMockDefcon({
      claim: vi.fn(async () => {
        claimCount++;
        if (claimCount === 1) {
          return {
            
            entity_id: "ent-1",
            invocation_id: "inv-1",
            flow: "test-flow",
            stage: "step-1",
            prompt: "First prompt",
          } satisfies ClaimResponse;
        }
        return { next_action: "check_back" as const, retry_after_ms: 60000, message: "No work" };
      }),
      report: vi.fn(async () => {
        reportCount++;
        if (reportCount === 1) {
          return {
            next_action: "continue" as const,
            new_state: "step-2",
            prompt: "Second prompt",
          };
        }
        return {
          next_action: "waiting" as const,
          gated: true as const,
          gateName: "done",
          gate_output: "finished",
        };
      }),
    });

    const dispatcher = createEchoDispatcher();
    const pool = new Pool(1);

    const loop = new RunLoop({
      pool,
      defcon: mockDefcon,
      dispatcher,
      role: "engineering",
      pollIntervalMs: 10,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 300));
    await loop.stop();

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatch).toHaveBeenNthCalledWith(
      1,
      "First prompt",
      expect.objectContaining({ entityId: "ent-1" }),
    );
    expect(dispatcher.dispatch).toHaveBeenNthCalledWith(
      2,
      "Second prompt",
      expect.objectContaining({ entityId: "ent-1" }),
    );
  });

  it("handles check_back on report by retrying after delay", async () => {
    let reportCount = 0;
    let claimCount = 0;
    const mockDefcon = createMockDefcon({
      claim: vi.fn(async () => {
        claimCount++;
        if (claimCount === 1) {
          return {
            
            entity_id: "ent-1",
            invocation_id: "inv-1",
            flow: "test-flow",
            stage: "step-1",
            prompt: "Do work",
          } satisfies ClaimResponse;
        }
        return { next_action: "check_back" as const, retry_after_ms: 60000, message: "No work" };
      }),
      report: vi.fn(async () => {
        reportCount++;
        if (reportCount === 1) {
          return {
            next_action: "check_back" as const,
            message: "Gate pending",
            retry_after_ms: 10,
          };
        }
        return {
          next_action: "waiting" as const,
          gated: true as const,
          gateName: "done",
          gate_output: "ok",
        };
      }),
    });

    const dispatcher = createEchoDispatcher();
    const pool = new Pool(1);

    const loop = new RunLoop({
      pool,
      defcon: mockDefcon,
      dispatcher,
      role: "engineering",
      pollIntervalMs: 10,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 300));
    await loop.stop();

    expect(mockDefcon.report).toHaveBeenCalledTimes(2);
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
  });

  it("reports crash when dispatch throws", async () => {
    let claimCount = 0;
    const mockDefcon = createMockDefcon({
      claim: vi.fn(async () => {
        claimCount++;
        if (claimCount === 1) {
          return {
            
            entity_id: "ent-1",
            invocation_id: "inv-1",
            flow: "test-flow",
            stage: "step-1",
            prompt: "Crash me",
          } satisfies ClaimResponse;
        }
        return { next_action: "check_back" as const, retry_after_ms: 60000, message: "No work" };
      }),
      report: vi.fn(async () => ({
        next_action: "waiting" as const,
        gated: true as const,
        gateName: "failed",
        gate_output: "error handled",
      })),
    });

    const failDispatcher: Dispatcher = {
      dispatch: vi.fn(async () => {
        throw new Error("process exploded");
      }),
    };

    const pool = new Pool(1);
    const loop = new RunLoop({
      pool,
      defcon: mockDefcon,
      dispatcher: failDispatcher,
      role: "engineering",
      pollIntervalMs: 10,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 200));
    await loop.stop();

    expect(mockDefcon.report).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: "ent-1",
        signal: "crash",
        artifacts: { error: "process exploded" },
      }),
    );
  });

  it("gracefully shuts down and waits for in-flight dispatch", async () => {
    let dispatchResolved = false;
    const mockDefcon = createMockDefcon({
      claim: vi.fn(async () => ({
        
        entity_id: "ent-1",
        invocation_id: "inv-1",
        flow: "test-flow",
        stage: "step-1",
        prompt: "Slow work",
        // This claim always returns work but we stop early (50ms) before dispatch finishes (150ms)
      })),
      report: vi.fn(async () => ({
        next_action: "waiting" as const,
        gated: true as const,
        gateName: "done",
        gate_output: "ok",
      })),
    });

    const slowDispatcher: Dispatcher = {
      dispatch: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 150));
        dispatchResolved = true;
        return { signal: "done", artifacts: {}, exitCode: 0 };
      }),
    };

    const pool = new Pool(1);
    const loop = new RunLoop({
      pool,
      defcon: mockDefcon,
      dispatcher: slowDispatcher,
      role: "engineering",
      pollIntervalMs: 10,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 50));
    await loop.stop();

    expect(dispatchResolved).toBe(true);
    expect(mockDefcon.report).toHaveBeenCalled();
  });
});
