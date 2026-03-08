import { describe, expect, it } from "vitest";
import { extractRepoFromDescription } from "../../../src/sources/linear/repo-extractor.js";

describe("extractRepoFromDescription", () => {
  it("extracts repo from standard format", () => {
    const desc = "**Repo:** wopr-network/radar\n\nSome description here";
    expect(extractRepoFromDescription(desc)).toBe("wopr-network/radar");
  });

  it("extracts repo from description with extra whitespace", () => {
    const desc = "**Repo:**   wopr-network/wopr-platform  \n\nMore text";
    expect(extractRepoFromDescription(desc)).toBe("wopr-network/wopr-platform");
  });

  it("returns null when description is null", () => {
    expect(extractRepoFromDescription(null)).toBeNull();
  });

  it("returns null when description is empty", () => {
    expect(extractRepoFromDescription("")).toBeNull();
  });

  it("returns null when no Repo line exists", () => {
    expect(extractRepoFromDescription("Some random description")).toBeNull();
  });

  it("returns null for malformed Repo line", () => {
    expect(extractRepoFromDescription("**Repo:**\n\nNo value")).toBeNull();
  });

  it("handles Repo line not on first line", () => {
    const desc = "## Title\n\n**Repo:** wopr-network/defcon\n\nBody";
    expect(extractRepoFromDescription(desc)).toBe("wopr-network/defcon");
  });
});
