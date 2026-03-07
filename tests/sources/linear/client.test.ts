import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinearClient } from "../../../src/sources/linear/client.js";

describe("LinearClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches issue with relations via GraphQL", async () => {
    const mockResponse = {
      data: {
        issue: {
          id: "issue-1",
          identifier: "WOP-100",
          title: "Test issue",
          state: { type: "backlog", name: "Backlog" },
          relations: {
            nodes: [
              {
                type: "blocks",
                relatedIssue: {
                  identifier: "WOP-99",
                  title: "Blocker",
                  state: { type: "started", name: "In Progress" },
                },
              },
            ],
          },
        },
      },
    };

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const client = new LinearClient({ apiKey: "test-key" });
    const issue = await client.getIssueWithRelations("issue-1");

    expect(issue.identifier).toBe("WOP-100");
    expect(issue.relations).toHaveLength(1);
    expect(issue.relations[0].type).toBe("blocks");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.linear.app/graphql",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "test-key",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as Response);

    const client = new LinearClient({ apiKey: "bad-key" });
    await expect(client.getIssueWithRelations("issue-1")).rejects.toThrow("Linear API error: 401");
  });

  it("throws on GraphQL errors", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ errors: [{ message: "Issue not found" }] }),
    } as Response);

    const client = new LinearClient({ apiKey: "test-key" });
    await expect(client.getIssueWithRelations("issue-1")).rejects.toThrow("Issue not found");
  });
});
