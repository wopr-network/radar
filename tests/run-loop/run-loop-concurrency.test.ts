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

describe("RunLoop concurrency enforcement", () => {
  it("skips claim when pool is at maxConcurrent for the flow", async () => {
    const pool = new Pool(4);
    pool.allocate("pre-1", "w1", "e1", "p1", "wopr-changeset", "wopr-network/wopr");
    pool.allocate("pre-2", "w2", "e2", "p2", "wopr-changeset", "wopr-network/defcon");

    let claimCallCount = 0;
    const defcon = createMockDefcon({
      claim: vi.fn(async () => {
        claimCallCount++;
        return { next_action: "check_back" as const, retry_after_ms: 100, message: "none" };
      }),
    });

    const loop = new RunLoop({
      pool,
      defcon,
      dispatcher: createEchoDispatcher(),
      role: "engineering",
      flow: "wopr-changeset",
      maxConcurrent: 2,
      pollIntervalMs: 50,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 200));
    await loop.stop();

    // claim should never be called — already at maxConcurrent=2
    expect(claimCallCount).toBe(0);
  });

  it("allows claim when under maxConcurrent", async () => {
    const pool = new Pool(4);
    pool.allocate("pre-1", "w1", "e1", "p1", "wopr-changeset", "wopr-network/wopr");

    let claimed = false;
    const defcon = createMockDefcon({
      claim: vi.fn(async () => {
        claimed = true;
        return { next_action: "check_back" as const, retry_after_ms: 50, message: "none" };
      }),
    });

    const loop = new RunLoop({
      pool,
      defcon,
      dispatcher: createEchoDispatcher(),
      role: "engineering",
      flow: "wopr-changeset",
      maxConcurrent: 4,
      pollIntervalMs: 50,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 200));
    await loop.stop();

    expect(claimed).toBe(true);
  });

  it("reports crash and skips when per-repo limit is reached", async () => {
    const pool = new Pool(4);
    pool.allocate("pre-1", "w1", "e1", "p1", "wopr-changeset", "wopr-network/wopr");
    pool.allocate("pre-2", "w2", "e2", "p2", "wopr-changeset", "wopr-network/wopr");

    let reportCallCount = 0;
    const defcon = createMockDefcon({
      claim: vi.fn(async () => ({
        workerId: "w3",
        entityId: "e3",
        invocationId: "inv3",
        flow: "wopr-changeset",
        stage: "spec",
        prompt: "**Repo:** wopr-network/wopr\nDo something",
      })),
      report: vi.fn(async () => {
        reportCallCount++;
        return {
          next_action: "waiting" as const,
          gated: true as const,
          gateName: "done",
          gate_output: "",
        };
      }),
    });

    const loop = new RunLoop({
      pool,
      defcon,
      dispatcher: createEchoDispatcher(),
      role: "engineering",
      flow: "wopr-changeset",
      maxConcurrentPerRepo: 2,
      pollIntervalMs: 50,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 200));
    await loop.stop();

    // report should be called with crash due to per-repo limit
    expect(defcon.report).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: "crash",
        artifacts: expect.objectContaining({ error: expect.stringContaining("wopr-network/wopr") }),
      }),
    );
  });

  it("does not enforce maxConcurrent when flow is undefined", async () => {
    const pool = new Pool(4);
    // Even with slots pre-filled with no flowName, maxConcurrent should not block
    pool.allocate("pre-1", "w1", "e1", "p1");
    pool.allocate("pre-2", "w2", "e2", "p2");

    let claimed = false;
    const defcon = createMockDefcon({
      claim: vi.fn(async () => {
        claimed = true;
        return { next_action: "check_back" as const, retry_after_ms: 50, message: "none" };
      }),
    });

    const loop = new RunLoop({
      pool,
      defcon,
      dispatcher: createEchoDispatcher(),
      role: "engineering",
      // no flow set
      maxConcurrent: 2,
      pollIntervalMs: 50,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 200));
    await loop.stop();

    // claim IS called — no flow means no enforcement
    expect(claimed).toBe(true);
  });
});
