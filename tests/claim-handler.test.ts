import { describe, expect, it, vi } from "vitest";
import { ClaimHandler } from "../src/claim/claim-handler.js";
import { InMemoryWorkerRepo } from "../src/worker/worker-repo.js";
import type { DefconClient } from "../src/defcon/client.js";
import type { ClaimResponse } from "@wopr-network/defcon";

function mockDefconClient(response: ClaimResponse): DefconClient {
  return {
    claim: vi.fn().mockResolvedValue(response),
    report: vi.fn(),
  } as unknown as DefconClient;
}

const workAssignment: ClaimResponse = {
  entity_id: "feat-99",
  invocation_id: "inv-1",
  flow: "engineering",
  state: "implement",
  refs: {},
  artifacts: {},
};

const checkBack: ClaimResponse = {
  next_action: "check_back",
  retry_after_ms: 5000,
  message: "No work available",
};

describe("ClaimHandler", () => {
  describe("auto-registration", () => {
    it("auto-registers when no workerId provided", async () => {
      const repo = new InMemoryWorkerRepo();
      const defcon = mockDefconClient(workAssignment);
      const handler = new ClaimHandler(defcon, repo);

      const result = await handler.handle({ role: "engineering" });

      expect(result.workerId).toMatch(/^wkr_[a-f0-9]{12}$/);
      expect(result.worker_notice).toContain(result.workerId);
      expect(repo.list()).toHaveLength(1);
      expect(repo.list()[0].type).toBe("unknown");
    });

    it("auto-registers when unknown workerId provided", async () => {
      const repo = new InMemoryWorkerRepo();
      const defcon = mockDefconClient(workAssignment);
      const handler = new ClaimHandler(defcon, repo);

      const result = await handler.handle({ workerId: "wkr_bogus123456", role: "qa" });

      expect(result.workerId).toMatch(/^wkr_[a-f0-9]{12}$/);
      expect(result.workerId).not.toBe("wkr_bogus123456");
      expect(result.worker_notice).toBeDefined();
    });

    it("reuses existing workerId", async () => {
      const repo = new InMemoryWorkerRepo();
      const defcon = mockDefconClient(workAssignment);
      const handler = new ClaimHandler(defcon, repo);

      const existing = repo.create({ type: "coder", discipline: "engineering" });
      const result = await handler.handle({ workerId: existing.id, role: "engineering" });

      expect(result.workerId).toBe(existing.id);
      expect(result.worker_notice).toBeUndefined();
      expect(repo.list()).toHaveLength(1);
    });

    it("uses workerType and discipline from request", async () => {
      const repo = new InMemoryWorkerRepo();
      const defcon = mockDefconClient(checkBack);
      const handler = new ClaimHandler(defcon, repo);

      const result = await handler.handle({
        role: "engineering",
        workerType: "coder",
        discipline: "backend",
      });

      const worker = repo.get(result.workerId)!;
      expect(worker.type).toBe("coder");
      expect(worker.discipline).toBe("backend");
    });
  });

  describe("claim forwarding", () => {
    it("forwards role and flow to DefconClient", async () => {
      const repo = new InMemoryWorkerRepo();
      const defcon = mockDefconClient(checkBack);
      const handler = new ClaimHandler(defcon, repo);

      await handler.handle({ role: "qa", flow: "security" });

      expect(defcon.claim).toHaveBeenCalledWith(
        expect.objectContaining({ role: "qa", flow: "security" }),
      );
    });

    it("passes auto-generated workerId to DefconClient", async () => {
      const repo = new InMemoryWorkerRepo();
      const defcon = mockDefconClient(checkBack);
      const handler = new ClaimHandler(defcon, repo);

      const result = await handler.handle({ role: "engineering" });

      expect(defcon.claim).toHaveBeenCalledWith(
        expect.objectContaining({ workerId: result.workerId }),
      );
    });

    it("returns claim response with workerId on check_back", async () => {
      const repo = new InMemoryWorkerRepo();
      const defcon = mockDefconClient(checkBack);
      const handler = new ClaimHandler(defcon, repo);

      const result = await handler.handle({ role: "engineering" });

      expect(result.workerId).toMatch(/^wkr_/);
      expect(result.claim).toEqual(checkBack);
    });

    it("returns claim response with workerId on work assignment", async () => {
      const repo = new InMemoryWorkerRepo();
      const defcon = mockDefconClient(workAssignment);
      const handler = new ClaimHandler(defcon, repo);

      const result = await handler.handle({ role: "engineering" });

      expect(result.workerId).toMatch(/^wkr_/);
      expect(result.claim).toEqual(workAssignment);
    });
  });

  describe("touch on reuse", () => {
    it("updates lastActivityAt when reusing a worker", async () => {
      const repo = new InMemoryWorkerRepo();
      const defcon = mockDefconClient(checkBack);
      const handler = new ClaimHandler(defcon, repo);

      const existing = repo.create({ type: "coder" });
      const before = existing.lastActivityAt;
      await new Promise((r) => setTimeout(r, 5));

      await handler.handle({ workerId: existing.id, role: "engineering" });

      const updated = repo.get(existing.id)!;
      expect(updated.lastActivityAt.getTime()).toBeGreaterThan(before.getTime());
    });
  });
});
