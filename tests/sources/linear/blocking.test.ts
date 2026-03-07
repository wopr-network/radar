import { describe, expect, it } from "vitest";
import { checkBlocking } from "../../../src/sources/linear/blocking.js";
import type { LinearRelation } from "../../../src/sources/linear/types.js";

describe("checkBlocking", () => {
  it("returns unblocked when issue has no relations", () => {
    const result = checkBlocking([]);
    expect(result.unblocked).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("returns unblocked when all blockers are completed", () => {
    const relations: LinearRelation[] = [
      {
        type: "blocked_by",
        relatedIssue: {
          identifier: "WOP-100",
          title: "Some blocker",
          state: { type: "completed", name: "Done" },
        },
      },
    ];
    const result = checkBlocking(relations);
    expect(result.unblocked).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("returns unblocked when all blockers are cancelled", () => {
    const relations: LinearRelation[] = [
      {
        type: "blocked_by",
        relatedIssue: {
          identifier: "WOP-101",
          title: "Cancelled blocker",
          state: { type: "canceled", name: "Canceled" },
        },
      },
    ];
    const result = checkBlocking(relations);
    expect(result.unblocked).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("returns blocked when a blocker is in progress", () => {
    const relations: LinearRelation[] = [
      {
        type: "blocked_by",
        relatedIssue: {
          identifier: "WOP-102",
          title: "Active blocker",
          state: { type: "started", name: "In Progress" },
        },
      },
    ];
    const result = checkBlocking(relations);
    expect(result.unblocked).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].identifier).toBe("WOP-102");
  });

  it("ignores non-blocks relation types", () => {
    const relations: LinearRelation[] = [
      {
        type: "related",
        relatedIssue: {
          identifier: "WOP-103",
          title: "Related issue",
          state: { type: "backlog", name: "Backlog" },
        },
      },
      {
        type: "duplicate",
        relatedIssue: {
          identifier: "WOP-104",
          title: "Duplicate",
          state: { type: "triage", name: "Triage" },
        },
      },
    ];
    const result = checkBlocking(relations);
    expect(result.unblocked).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("returns only unresolved blockers in the blockers list", () => {
    const relations: LinearRelation[] = [
      {
        type: "blocked_by",
        relatedIssue: {
          identifier: "WOP-200",
          title: "Done blocker",
          state: { type: "completed", name: "Done" },
        },
      },
      {
        type: "blocked_by",
        relatedIssue: {
          identifier: "WOP-201",
          title: "Still blocking",
          state: { type: "unstarted", name: "Todo" },
        },
      },
      {
        type: "blocked_by",
        relatedIssue: {
          identifier: "WOP-202",
          title: "Also blocking",
          state: { type: "backlog", name: "Backlog" },
        },
      },
    ];
    const result = checkBlocking(relations);
    expect(result.unblocked).toBe(false);
    expect(result.blockers).toHaveLength(2);
    expect(result.blockers.map((b) => b.identifier)).toEqual(["WOP-201", "WOP-202"]);
  });
});
