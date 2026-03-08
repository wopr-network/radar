import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinearClient } from "../../../src/sources/linear/client.js";
import type { LinearSearchIssue } from "../../../src/sources/linear/types.js";

describe("LinearClient.searchIssues", () => {
  let client: LinearClient;

  beforeEach(() => {
    client = new LinearClient({ apiKey: "test-key" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns issues matching state filter", async () => {
    const mockIssues = [
      {
        id: "issue-1",
        identifier: "WOP-100",
        title: "Test issue",
        description: "**Repo:** wopr-network/radar\n\nBody",
        state: { type: "unstarted", name: "Todo" },
        labels: { nodes: [{ name: "defcon" }] },
      },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { issues: { nodes: mockIssues, pageInfo: { hasNextPage: false, endCursor: null } } } }),
        { status: 200 },
      ),
    );

    const result = await client.searchIssues({ stateName: "Todo" });
    expect(result).toHaveLength(1);
    expect(result[0].identifier).toBe("WOP-100");
    expect(result[0].description).toBe("**Repo:** wopr-network/radar\n\nBody");
    expect(result[0].labels).toEqual([{ name: "defcon" }]);
  });

  it("throws on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(client.searchIssues({ stateName: "Todo" })).rejects.toThrow("Linear API error: 401");
  });

  it("throws on GraphQL errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ message: "Bad query" }] }), { status: 200 }),
    );

    await expect(client.searchIssues({ stateName: "Todo" })).rejects.toThrow("Bad query");
  });
});
