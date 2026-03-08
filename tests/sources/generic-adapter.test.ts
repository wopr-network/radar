import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Source, Watch } from "../../src/api/types.js";
import { GenericSourceAdapter } from "../../src/sources/generic-adapter.js";

function makeSource(secret?: string): Source {
  return {
    id: "src-1",
    name: "generic",
    type: "webhook",
    config: secret ? { secret } : {},
    enabled: true,
    created_at: 0,
    updated_at: 0,
  };
}

function makeWatch(): Watch {
  return {
    id: "w-1",
    source_id: "src-1",
    name: "test-watch",
    filter: {},
    action: "ingest",
    action_config: { flowName: "default-flow" },
    enabled: true,
    created_at: 0,
    updated_at: 0,
  };
}

describe("GenericSourceAdapter", () => {
  const adapter = new GenericSourceAdapter();

  it("has type 'webhook'", () => {
    expect(adapter.type).toBe("webhook");
  });

  it("parseEvent returns IngestEvent using first enabled watch flowName", () => {
    const payload = { id: "ext-1", event: "trigger" };
    const result = adapter.parseEvent(payload, makeSource(), [makeWatch()]);
    expect(result).not.toBeNull();
    expect(result!.sourceId).toBe("src-1");
    expect(result!.flowName).toBe("default-flow");
    expect(result!.type).toBe("new");
  });

  it("parseEvent returns null when no watches", () => {
    const result = adapter.parseEvent({}, makeSource(), []);
    expect(result).toBeNull();
  });

  it("parseEvent uses payload.id as externalId", () => {
    const result = adapter.parseEvent({ id: "abc" }, makeSource(), [makeWatch()]);
    expect(result!.externalId).toBe("abc");
  });

  it("verifySignature uses standard HMAC", () => {
    const secret = "s3cret";
    const body = "test-body";
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const headers = { "x-webhook-signature": sig };
    const result = adapter.verifySignature(body, makeSource(secret), headers);
    expect(result.valid).toBe(true);
  });

  it("verifySignature passes when no secret configured", () => {
    const result = adapter.verifySignature("body", makeSource(), {});
    expect(result.valid).toBe(true);
  });
});
