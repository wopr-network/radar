import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Source, Watch } from "../../src/api/types.js";
import { LinearSourceAdapter } from "../../src/sources/linear-adapter.js";

function makeSource(secret?: string): Source {
  return {
    id: "src-1",
    name: "linear",
    type: "linear",
    config: secret ? { secret } : {},
    enabled: true,
    created_at: 0,
    updated_at: 0,
  };
}

function makeWatch(filter: Record<string, unknown> = {}): Watch {
  return {
    id: "w-1",
    source_id: "src-1",
    name: "test-watch",
    filter,
    action: "ingest",
    action_config: { flowName: "my-flow" },
    enabled: true,
    created_at: 0,
    updated_at: 0,
  };
}

describe("LinearSourceAdapter", () => {
  const adapter = new LinearSourceAdapter();

  it("has type 'linear'", () => {
    expect(adapter.type).toBe("linear");
  });

  it("parseEvent returns IngestEvent for matching Linear webhook", () => {
    const payload = {
      action: "create",
      type: "Issue",
      data: {
        id: "issue-1",
        identifier: "WOP-100",
        title: "Test issue",
        description: null,
      },
    };
    const result = adapter.parseEvent(payload, makeSource(), [makeWatch()]);
    expect(result).not.toBeNull();
    expect(result!.sourceId).toBe("src-1");
    expect(result!.externalId).toBe("issue-1");
    expect(result!.flowName).toBe("my-flow");
  });

  it("parseEvent returns null for non-Issue type", () => {
    const payload = {
      action: "create",
      type: "Comment",
      data: { id: "c-1", identifier: "WOP-100", title: "x" },
    };
    const result = adapter.parseEvent(payload, makeSource(), [makeWatch()]);
    expect(result).toBeNull();
  });

  it("parseEvent returns null when no watches match filter", () => {
    const payload = {
      action: "create",
      type: "Issue",
      data: {
        id: "issue-1",
        identifier: "WOP-100",
        title: "Test",
        description: null,
        state: { name: "Done", type: "completed" },
      },
    };
    const watch = makeWatch({ state: "In Progress" });
    const result = adapter.parseEvent(payload, makeSource(), [watch]);
    expect(result).toBeNull();
  });

  it("parseEvent skips disabled watches", () => {
    const payload = {
      action: "create",
      type: "Issue",
      data: { id: "issue-1", identifier: "WOP-100", title: "Test", description: null },
    };
    const watch = { ...makeWatch(), enabled: false };
    const result = adapter.parseEvent(payload, makeSource(), [watch]);
    expect(result).toBeNull();
  });

  it("verifySignature passes with correct HMAC", () => {
    const secret = "test-secret";
    const body = '{"hello":"world"}';
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const headers = { "x-linear-signature": sig };
    const result = adapter.verifySignature(body, makeSource(secret), headers);
    expect(result.valid).toBe(true);
  });

  it("verifySignature fails with wrong HMAC", () => {
    const headers = { "x-linear-signature": "deadbeef".repeat(8) };
    const result = adapter.verifySignature('{"x":1}', makeSource("secret"), headers);
    expect(result.valid).toBe(false);
  });

  it("verifySignature passes when source has no secret", () => {
    const result = adapter.verifySignature("body", makeSource(), {});
    expect(result.valid).toBe(true);
  });
});
