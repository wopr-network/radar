import { describe, expect, it } from "vitest";
import { handleLinearWebhook } from "../../../src/sources/linear/webhook-handler.js";

describe("handleLinearWebhook", () => {
  it("converts a Linear webhook state change to IngestEvent", () => {
    const payload = {
      action: "update",
      type: "Issue",
      data: {
        id: "lin-uuid-1",
        identifier: "WOP-100",
        title: "Test issue",
        description: "**Repo:** wopr-network/norad\n\nBody",
        state: { name: "Todo", type: "unstarted" },
        labels: [{ name: "defcon" }],
      },
      updatedFrom: { stateId: "old-state-id" },
    };

    const result = handleLinearWebhook(payload, {
      sourceId: "linear-main",
      flowName: "wopr-changeset",
      filter: { state: "Todo", labels: ["defcon"] },
    });

    expect(result).toEqual({
      sourceId: "linear-main",
      externalId: "lin-uuid-1",
      type: "new",
      flowName: "wopr-changeset",
      payload: {
        refs: {
          linear: {
            id: "lin-uuid-1",
            key: "WOP-100",
            title: "Test issue",
            description: "**Repo:** wopr-network/norad\n\nBody",
          },
          github: { repo: "wopr-network/norad" },
        },
      },
    });
  });

  it("returns null when state does not match filter", () => {
    const payload = {
      action: "update",
      type: "Issue",
      data: {
        id: "lin-uuid-1",
        identifier: "WOP-100",
        title: "Test",
        description: null,
        state: { name: "In Progress", type: "started" },
        labels: [],
      },
      updatedFrom: { stateId: "old" },
    };

    const result = handleLinearWebhook(payload, {
      sourceId: "linear-main",
      flowName: "wopr-changeset",
      filter: { state: "Todo" },
    });

    expect(result).toBeNull();
  });

  it("returns null when labels do not match filter", () => {
    const payload = {
      action: "update",
      type: "Issue",
      data: {
        id: "lin-uuid-1",
        identifier: "WOP-100",
        title: "Test",
        description: null,
        state: { name: "Todo", type: "unstarted" },
        labels: [{ name: "unrelated" }],
      },
      updatedFrom: { stateId: "old" },
    };

    const result = handleLinearWebhook(payload, {
      sourceId: "linear-main",
      flowName: "wopr-changeset",
      filter: { state: "Todo", labels: ["defcon"] },
    });

    expect(result).toBeNull();
  });

  it("returns null for non-Issue webhook types", () => {
    const payload = { action: "create", type: "Comment", data: {} };

    const result = handleLinearWebhook(payload, {
      sourceId: "linear-main",
      flowName: "wopr-changeset",
      filter: {},
    });

    expect(result).toBeNull();
  });

  it("accepts real Linear webhook format with stateId and labelIds", () => {
    const payload = {
      action: "update",
      type: "Issue",
      data: {
        id: "lin-uuid-2",
        identifier: "WOP-200",
        title: "Real webhook issue",
        description: "**Repo:** wopr-network/norad\n\nBody",
        stateId: "state-uuid-todo",
        labelIds: ["label-uuid-defcon"],
      },
      updatedFrom: { stateId: "old-state-id" },
    };

    const result = handleLinearWebhook(payload, {
      sourceId: "linear-main",
      flowName: "wopr-changeset",
      filter: { stateId: "state-uuid-todo", labelIds: ["label-uuid-defcon"] },
    });

    expect(result).toEqual({
      sourceId: "linear-main",
      externalId: "lin-uuid-2",
      type: "new",
      flowName: "wopr-changeset",
      payload: {
        refs: {
          linear: {
            id: "lin-uuid-2",
            key: "WOP-200",
            title: "Real webhook issue",
            description: "**Repo:** wopr-network/norad\n\nBody",
          },
          github: { repo: "wopr-network/norad" },
        },
      },
    });
  });

  it("returns null when stateId does not match filter", () => {
    const payload = {
      action: "update",
      type: "Issue",
      data: {
        id: "lin-uuid-2",
        identifier: "WOP-200",
        title: "Real webhook issue",
        description: null,
        stateId: "state-uuid-in-progress",
        labelIds: [],
      },
    };

    const result = handleLinearWebhook(payload, {
      sourceId: "linear-main",
      flowName: "wopr-changeset",
      filter: { stateId: "state-uuid-todo" },
    });

    expect(result).toBeNull();
  });

  it("returns null when labelIds do not match filter", () => {
    const payload = {
      action: "update",
      type: "Issue",
      data: {
        id: "lin-uuid-2",
        identifier: "WOP-200",
        title: "Real webhook issue",
        description: null,
        stateId: "state-uuid-todo",
        labelIds: ["label-uuid-other"],
      },
    };

    const result = handleLinearWebhook(payload, {
      sourceId: "linear-main",
      flowName: "wopr-changeset",
      filter: { stateId: "state-uuid-todo", labelIds: ["label-uuid-defcon"] },
    });

    expect(result).toBeNull();
  });
});
