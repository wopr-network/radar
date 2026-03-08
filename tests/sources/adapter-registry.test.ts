import { describe, expect, it } from "vitest";
import { SourceAdapterRegistry } from "../../src/sources/adapter.js";
import type { SourceAdapter } from "../../src/sources/adapter.js";

function makeStubAdapter(type: string): SourceAdapter {
  return {
    type,
    parseEvent: () => null,
    verifySignature: () => ({ valid: true }),
  };
}

describe("SourceAdapterRegistry", () => {
  it("registers and retrieves an adapter by type", () => {
    const registry = new SourceAdapterRegistry();
    const adapter = makeStubAdapter("linear");
    registry.register(adapter);
    expect(registry.get("linear")).toBe(adapter);
  });

  it("returns undefined for unregistered type", () => {
    const registry = new SourceAdapterRegistry();
    expect(registry.get("unknown")).toBeUndefined();
  });

  it("has() returns true for registered, false for unregistered", () => {
    const registry = new SourceAdapterRegistry();
    registry.register(makeStubAdapter("github"));
    expect(registry.has("github")).toBe(true);
    expect(registry.has("jira")).toBe(false);
  });
});
