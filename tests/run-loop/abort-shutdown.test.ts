import { afterEach, describe, expect, it, vi } from "vitest";
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

function mockFetchWithSignal() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn((_url: string, opts?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = opts?.signal as AbortSignal | undefined;
      if (signal?.aborted) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }) as typeof fetch;
  return originalFetch;
}

describe("DefconClient abort support", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("claim() rejects when signal is aborted", async () => {
    const originalFetch = mockFetchWithSignal();

    const { DefconClient } = await import("../../src/defcon/client.js");
    const client = new DefconClient({ url: "http://localhost:9999" });
    const ac = new AbortController();

    const claimPromise = client.claim({ workerId: "w1", role: "engineering" }, { signal: ac.signal });

    ac.abort();

    await expect(claimPromise).rejects.toThrow();

    globalThis.fetch = originalFetch;
  });

  it("report() rejects when signal is aborted", async () => {
    const originalFetch = mockFetchWithSignal();

    const { DefconClient } = await import("../../src/defcon/client.js");
    const client = new DefconClient({ url: "http://localhost:9999" });
    const ac = new AbortController();

    const reportPromise = client.report(
      { workerId: "w1", entityId: "e1", signal: "done" },
      { signal: ac.signal },
    );

    ac.abort();

    await expect(reportPromise).rejects.toThrow();

    globalThis.fetch = originalFetch;
  });
});

describe("RunLoop abort-aware shutdown", () => {
  it("stop() resolves within stopTimeoutMs even if claim hangs", async () => {
    const hangingClaim = vi.fn(
      () =>
        new Promise<ClaimResponse>(() => {
          // never resolves
        }),
    );

    const mockDefcon = createMockDefcon({ claim: hangingClaim });
    const dispatcher: Dispatcher = {
      dispatch: vi.fn(async (_prompt: string, _opts: DispatchOpts): Promise<WorkerResult> => ({
        signal: "done",
        artifacts: {},
        exitCode: 0,
      })),
    };
    const pool = new Pool(1);

    const loop = new RunLoop({
      pool,
      defcon: mockDefcon,
      dispatcher,
      role: "engineering",
      pollIntervalMs: 10,
      stopTimeoutMs: 500,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 50));

    const start = Date.now();
    await loop.stop();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(800);
  });

  it("stop() resolves within stopTimeoutMs even if report hangs", async () => {
    let claimCount = 0;
    const mockDefcon = createMockDefcon({
      claim: vi.fn(async () => {
        claimCount++;
        if (claimCount === 1) {
          return {
            workerId: "wkr-1",
            entityId: "ent-1",
            invocationId: "inv-1",
            flow: "f",
            stage: "s",
            prompt: "go",
          } satisfies ClaimResponse;
        }
        return { next_action: "check_back" as const, retry_after_ms: 60000, message: "no" };
      }),
      report: vi.fn(
        () =>
          new Promise<ReportResponse>(() => {
            // never resolves
          }),
      ),
    });

    const dispatcher: Dispatcher = {
      dispatch: vi.fn(async (_prompt: string, _opts: DispatchOpts): Promise<WorkerResult> => ({
        signal: "done",
        artifacts: {},
        exitCode: 0,
      })),
    };
    const pool = new Pool(1);

    const loop = new RunLoop({
      pool,
      defcon: mockDefcon,
      dispatcher,
      role: "engineering",
      pollIntervalMs: 10,
      stopTimeoutMs: 500,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 100));

    const start = Date.now();
    await loop.stop();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(800);
  });
});
