import { describe, expect, it } from "vitest";
import { renderWorkerPrompt } from "../src/cli/worker-prompt.js";

describe("renderWorkerPrompt", () => {
  it("includes the worker ID", () => {
    const result = renderWorkerPrompt({
      workerId: "wkr-abc-123",
      discipline: "engineering",
      defconUrl: "http://localhost:3000",
    });
    expect(result).toContain("wkr-abc-123");
  });

  it("includes the discipline", () => {
    const result = renderWorkerPrompt({
      workerId: "wkr-abc-123",
      discipline: "qa",
      defconUrl: "http://localhost:3000",
    });
    expect(result).toContain("qa");
  });

  it("includes the DEFCON URL", () => {
    const result = renderWorkerPrompt({
      workerId: "wkr-abc-123",
      discipline: "engineering",
      defconUrl: "http://defcon.example.com",
    });
    expect(result).toContain("http://defcon.example.com");
  });

  it("includes flow.claim instruction", () => {
    const result = renderWorkerPrompt({
      workerId: "wkr-abc-123",
      discipline: "engineering",
      defconUrl: "http://localhost:3000",
    });
    expect(result).toContain("flow.claim");
  });

  it("includes flow.report instruction", () => {
    const result = renderWorkerPrompt({
      workerId: "wkr-abc-123",
      discipline: "engineering",
      defconUrl: "http://localhost:3000",
    });
    expect(result).toContain("flow.report");
  });

  it("escapes special characters in workerId within JSON body", () => {
    const result = renderWorkerPrompt({
      workerId: 'wkr-"evil"',
      discipline: "engineering",
      defconUrl: "http://localhost:3000",
    });
    expect(result).not.toContain('"workerId": "wkr-"evil""');
    expect(result).toContain('"workerId": "wkr-\\"evil\\""');
  });

  it("normalizes trailing slash in DEFCON URL", () => {
    const result = renderWorkerPrompt({
      workerId: "wkr-abc-123",
      discipline: "engineering",
      defconUrl: "http://localhost:3000/",
    });
    expect(result).not.toContain("//api/mcp");
    expect(result).toContain("http://localhost:3000/api/mcp");
  });
});
