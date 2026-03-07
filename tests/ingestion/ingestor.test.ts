import { describe, expect, it, vi } from "vitest";
import { createDb } from "../../src/db/index.js";
import type { DefconClient } from "../../src/defcon/client.js";
import { DrizzleEntityMapRepository } from "../../src/db/repos/entity-map-repo.js";
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
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

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
    });
    expect(defcon.report).not.toHaveBeenCalled();
  });

  it("deduplicates: skips createEntity on second 'new' for same externalId", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" });
    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" });

    expect(defcon.createEntity).toHaveBeenCalledOnce();
  });

  it("calls flow.report for an 'update' event on a known entity", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

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
      entityId: "entity-abc",
      signal: "merged",
      artifacts: { sha: "abc123" },
    });
  });

  it("ignores 'update' for unknown externalId", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-99", type: "update", flowName: "wopr-release" });

    expect(defcon.createEntity).not.toHaveBeenCalled();
    expect(defcon.report).not.toHaveBeenCalled();
  });

  it("uses 'update' as default signal when signal is omitted", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" });
    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "update", flowName: "wopr-release" });

    expect(defcon.report).toHaveBeenCalledWith(
      expect.objectContaining({ signal: "update" }),
    );
  });

  it("handleUpdate: does not forward sentinel entityId to defcon", async () => {
    const db = createDb();
    // Simulate a race: sentinel row exists but createEntity hasn't completed yet
    const repo = new DrizzleEntityMapRepository(db);
    repo.insertIfAbsent("gh", "pr-42", "__pending__");

    const defcon = makeDefcon();
    const ingestor = new Ingestor(repo, defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "update", flowName: "wopr-release" });

    expect(defcon.report).not.toHaveBeenCalled();
  });

  it("handleNew: cleans up sentinel row on createEntity failure so future events can retry", async () => {
    const db = createDb();
    const defcon = makeDefcon({
      createEntity: vi.fn().mockRejectedValueOnce(new Error("defcon unavailable")).mockResolvedValue({ entityId: "entity-abc" }),
    });
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

    // First attempt fails
    await expect(
      ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" }),
    ).rejects.toThrow("defcon unavailable");

    // Second attempt should succeed (sentinel was cleaned up)
    await ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" });

    expect(defcon.createEntity).toHaveBeenCalledTimes(2);
  });

  it("throws ZodError for invalid event", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

    await expect(ingestor.ingest({ sourceId: "", externalId: "x", type: "new", flowName: "f" })).rejects.toThrow();
  });

  it("TOCTOU: concurrent 'new' events for the same key create only one DEFCON entity", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

    // Fire two concurrent ingestions for the same key
    await Promise.all([
      ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" }),
      ingestor.ingest({ sourceId: "gh", externalId: "pr-42", type: "new", flowName: "wopr-release" }),
    ]);

    expect(defcon.createEntity).toHaveBeenCalledOnce();
  });

  it("collision: sourceId containing ':' does not collide with different (sourceId, externalId) pair", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

    // "a:b" + "c" vs "a" + "b:c" would collide with colon-concatenation
    await ingestor.ingest({ sourceId: "a:b", externalId: "c", type: "new", flowName: "wopr-release" });
    await ingestor.ingest({ sourceId: "a", externalId: "b:c", type: "new", flowName: "wopr-release" });

    expect(defcon.createEntity).toHaveBeenCalledTimes(2);
  });

  it("scopes entity map by sourceId — same externalId from different sources are independent", async () => {
    const db = createDb();
    const defcon = makeDefcon();
    const ingestor = new Ingestor(new DrizzleEntityMapRepository(db), defcon);

    await ingestor.ingest({ sourceId: "gh", externalId: "pr-1", type: "new", flowName: "wopr-release" });
    await ingestor.ingest({ sourceId: "linear", externalId: "pr-1", type: "new", flowName: "wopr-release" });

    expect(defcon.createEntity).toHaveBeenCalledTimes(2);
  });
});
