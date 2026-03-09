import { describe, expect, it } from "vitest";
import { parseRoles } from "../src/cli/index.js";

describe("parseRoles", () => {
  it("parses a single bare role using --workers count", () => {
    const result = parseRoles(["engineering"], 4);
    expect(result).toEqual([{ discipline: "engineering", count: 4 }]);
  });

  it("parses a single bare role defaulting to 1 when no workers given", () => {
    const result = parseRoles(["engineering"], undefined);
    expect(result).toEqual([{ discipline: "engineering", count: 1 }]);
  });

  it("parses discipline:count format", () => {
    const result = parseRoles(["engineering:3", "devops:2"], undefined);
    expect(result).toEqual([
      { discipline: "engineering", count: 3 },
      { discipline: "devops", count: 2 },
    ]);
  });

  it("throws when multiple bare roles are combined with --workers", () => {
    expect(() => parseRoles(["engineering", "devops"], 4)).toThrow(
      /bare --role shorthand only works for a single discipline/i,
    );
  });

  it("throws when multiple bare roles given without --workers", () => {
    expect(() => parseRoles(["engineering", "devops"], undefined)).toThrow(
      /bare --role shorthand only works for a single discipline/i,
    );
  });

  it("throws on extra colon segments", () => {
    expect(() => parseRoles(["engineering:6:extra"], undefined)).toThrow(
      /invalid.*--role.*format/i,
    );
  });

  it("throws on invalid discipline", () => {
    expect(() => parseRoles(["wizard"], undefined)).toThrow(/invalid role/i);
  });

  it("throws on non-integer count", () => {
    expect(() => parseRoles(["engineering:abc"], undefined)).toThrow(/positive integer/i);
  });

  it("throws on zero count", () => {
    expect(() => parseRoles(["engineering:0"], undefined)).toThrow(/positive integer/i);
  });
});
