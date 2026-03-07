import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../src/db/index.js";
import type { DefconClient } from "../../src/defcon/client.js";
import { Ingestor } from "../../src/ingestion/ingestor.js";

function makeDefcon(overrides: Partial<DefconClient> = {}): DefconClient {
  return {
    claim: vi.fn(),
    createEntity: vi.fn().mockResolvedValue({ entityId: "entity-abc" }),
    report: vi.fn().mockResolvedValue({ next_action: "continue", new_state: "done", prompt: "" }),
    ...overrides,
  } as unknown as DefconClient;
}

describe("Ingestor", () => {
  it("creates a new entity for a 'new' event", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(db, defcon);

    await ingestor.ingest({
      sourceId: "gh",
      externalId: "pr-42",
      type: "new",
      flowName: "wopr-release",
      payload: { tag: "v1.0.0" },
    });

    expect(defcon.createEntity).toHaveBeenCalledOnce();
    expect(defcon.createEntity).toHaveBeenCalledWith({
      flowName: "wopr-release",
      payload: { tag: "v1.0.0" },
    });
    expect(defcon.report).not.toHaveBeenCalled();
  });

  it("deduplicates: skips createEntity on second 'new' for same externalId", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(db, defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" });
    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" });

    expect(defcon.createEntity).toHaveBeenCalledOnce();
  });

  it("calls flow.report for an 'update' event on a known entity", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(db, defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" });
    await ingestor.ingest({
      sourceId: "gh",
      externalId: "pr-42",
      type: "update",
      flowName: "wopr-release",
      signal: "merged",
      payload: { sha: "abc123" },
    });

    expect(defcon.report).toHaveBeenCalledOnce();
    expect(defcon.report).toHaveBeenCalledWith({
      workerId: "norad",
      entityId: "entity-abc",
      signal: "merged",
      artifacts: { sha: "abc123" },
    });
  });

  it("ignores 'update' for unknown externalId", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(db, defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-99", type: "update", flowName: "wopr-release" });

    expect(defcon.createEntity).not.toHaveBeenCalled();
    expect(defcon.report).not.toHaveBeenCalled();
  });

  it("uses 'update' as default signal when signal is omitted", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(db, defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" });
    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "update", flowName: "wopr-release" });

    expect(defcon.report).toHaveBeenCalledWith(
      expect.objectContaining({ signal: "update" }),
    );
  });

  it("throws ZodError for invalid event", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(db, defcon);

    await expect(ingestor.ingest({ sourceId: "", externalId: "x", type: "new", flowName: "f" })).rejects.toThrow();
  });

  it("scopes entity map by sourceId — same externalId from different sources are independent", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(db, defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-1", type: "new", flowName: "wopr-release" });
    await ingestor.ingest({ sourceId: "linear", externalId: "pr-1", type: "new", flowName: "wopr-release" });

    expect(defcon.createEntity).toHaveBeenCalledTimes(2);
  });
});
