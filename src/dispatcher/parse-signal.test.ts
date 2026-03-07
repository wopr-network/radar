import { describe, expect, it } from "vitest";
import { parseSignal } from "./parse-signal.js";

describe("parseSignal", () => {
  it("extracts spec_ready signal", () => {
    const output = "Some preamble\nSpec ready: WOP-1934\nDone.";
    const result = parseSignal(output);
    expect(result.signal).toBe("spec_ready");
    expect(result.artifacts).toEqual({ issueKey: "WOP-1934" });
  });

  it("extracts pr_created signal with URL and number", () => {
    const output = "PR created: https://github.com/wopr-network/norad/pull/42";
    const result = parseSignal(output);
    expect(result.signal).toBe("pr_created");
    expect(result.artifacts).toEqual({
      prUrl: "https://github.com/wopr-network/norad/pull/42",
      prNumber: 42,
    });
  });

  it("extracts clean signal", () => {
    const output = "CLEAN: https://github.com/wopr-network/norad/pull/42";
    const result = parseSignal(output);
    expect(result.signal).toBe("clean");
    expect(result.artifacts).toEqual({
      url: "https://github.com/wopr-network/norad/pull/42",
    });
  });

  it("extracts issues signal with findings", () => {
    const output = "ISSUES: https://github.com/wopr-network/norad/pull/42 — unused import; missing test";
    const result = parseSignal(output);
    expect(result.signal).toBe("issues");
    expect(result.artifacts).toEqual({
      url: "https://github.com/wopr-network/norad/pull/42",
      reviewFindings: ["unused import", "missing test"],
    });
  });

  it("extracts fixes_pushed signal", () => {
    const output = "Fixes pushed: https://github.com/wopr-network/norad/pull/42";
    const result = parseSignal(output);
    expect(result.signal).toBe("fixes_pushed");
    expect(result.artifacts).toEqual({
      url: "https://github.com/wopr-network/norad/pull/42",
    });
  });

  it("extracts merged signal", () => {
    const output = "Merged: https://github.com/wopr-network/norad/pull/42";
    const result = parseSignal(output);
    expect(result.signal).toBe("merged");
    expect(result.artifacts).toEqual({
      url: "https://github.com/wopr-network/norad/pull/42",
    });
  });

  it("returns unknown when no signal found", () => {
    const output = "Just some random output\nnothing here";
    const result = parseSignal(output);
    expect(result.signal).toBe("unknown");
    expect(result.artifacts).toEqual({});
  });

  it("picks the last signal when multiple are present", () => {
    const output = "Spec ready: WOP-100\nMerged: https://github.com/org/repo/pull/5";
    const result = parseSignal(output);
    expect(result.signal).toBe("merged");
  });
});
