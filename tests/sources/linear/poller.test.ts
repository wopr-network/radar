import { afterEach, describe, expect, it, vi } from "vitest";
import type { IEntityMapRepository } from "../../../src/db/repos/entity-map-repo.js";
import type { DefconClient } from "../../../src/defcon/client.js";
import { Ingestor } from "../../../src/ingestion/ingestor.js";
import type { LinearClient } from "../../../src/sources/linear/client.js";
import { LinearPoller } from "../../../src/sources/linear/poller.js";
import type { LinearSearchIssue } from "../../../src/sources/linear/types.js";

function mockEntityMapRepo(): IEntityMapRepository {
  return {
    findEntityId: vi.fn().mockReturnValue(undefined),
    insertIfAbsent: vi.fn().mockReturnValue(true),
    updateEntityId: vi.fn(),
    deleteRow: vi.fn(),
  };
}

function mockDefconClient(): DefconClient {
  return {
    claim: vi.fn(),
    createEntity: vi.fn().mockResolvedValue({ entityId: "ent-1" }),
    report: vi.fn(),
  } as unknown as DefconClient;
}

function mockLinearClient(issues: LinearSearchIssue[] = []): LinearClient {
  return {
    searchIssues: vi.fn().mockResolvedValue(issues),
    getIssueWithRelations: vi.fn(),
  } as unknown as LinearClient;
}

describe("LinearPoller", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("polls Linear and ingests matching issues", async () => {
    const issue: LinearSearchIssue = {
      id: "lin-uuid-1",
      identifier: "WOP-100",
      title: "Add feature X",
      description: "**Repo:** wopr-network/norad\n\nDetails",
      state: { type: "unstarted", name: "Todo" },
      labels: [{ name: "defcon" }],
    };

    const linearClient = mockLinearClient([issue]);
    const entityMapRepo = mockEntityMapRepo();
    const defconClient = mockDefconClient();
    const ingestor = new Ingestor(entityMapRepo, defconClient);

    const poller = new LinearPoller({
      linearClient,
      ingestor,
      watches: [
        {
          id: "watch-1",
          sourceId: "linear-main",
          flowName: "wopr-changeset",
          filter: { state: "Todo", labels: ["defcon"] },
        },
      ],
    });

    await poller.pollOnce();

    expect(linearClient.searchIssues).toHaveBeenCalledWith({ stateName: "Todo" });
    expect(entityMapRepo.insertIfAbsent).toHaveBeenCalledWith("linear-main", "lin-uuid-1", "__pending__");
    expect(defconClient.createEntity).toHaveBeenCalledWith({
      flowName: "wopr-changeset",
      payload: {
        refs: {
          linear: {
            id: "lin-uuid-1",
            key: "WOP-100",
            title: "Add feature X",
            description: "**Repo:** wopr-network/norad\n\nDetails",
          },
          github: { repo: "wopr-network/norad" },
        },
      },
    });
  });

  it("skips issues already in entity-map (dedup)", async () => {
    const issue: LinearSearchIssue = {
      id: "lin-uuid-1",
      identifier: "WOP-100",
      title: "Already tracked",
      description: "**Repo:** wopr-network/norad",
      state: { type: "unstarted", name: "Todo" },
      labels: [{ name: "defcon" }],
    };

    const linearClient = mockLinearClient([issue]);
    const entityMapRepo = mockEntityMapRepo();
    (entityMapRepo.insertIfAbsent as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const defconClient = mockDefconClient();
    const ingestor = new Ingestor(entityMapRepo, defconClient);

    const poller = new LinearPoller({
      linearClient,
      ingestor,
      watches: [
        { id: "watch-1", sourceId: "linear-main", flowName: "wopr-changeset", filter: { state: "Todo", labels: ["defcon"] } },
      ],
    });

    await poller.pollOnce();

    expect(defconClient.createEntity).not.toHaveBeenCalled();
  });

  it("skips issues that do not match label filter", async () => {
    const issue: LinearSearchIssue = {
      id: "lin-uuid-1",
      identifier: "WOP-100",
      title: "Wrong label",
      description: "**Repo:** wopr-network/norad",
      state: { type: "unstarted", name: "Todo" },
      labels: [{ name: "unrelated" }],
    };

    const linearClient = mockLinearClient([issue]);
    const entityMapRepo = mockEntityMapRepo();
    const defconClient = mockDefconClient();
    const ingestor = new Ingestor(entityMapRepo, defconClient);

    const poller = new LinearPoller({
      linearClient,
      ingestor,
      watches: [
        { id: "watch-1", sourceId: "linear-main", flowName: "wopr-changeset", filter: { state: "Todo", labels: ["defcon"] } },
      ],
    });

    await poller.pollOnce();

    expect(entityMapRepo.insertIfAbsent).not.toHaveBeenCalled();
  });

  it("skips issues with no repo in description but still ingests", async () => {
    const issue: LinearSearchIssue = {
      id: "lin-uuid-1",
      identifier: "WOP-100",
      title: "No repo",
      description: "No repo line here",
      state: { type: "unstarted", name: "Todo" },
      labels: [{ name: "defcon" }],
    };

    const linearClient = mockLinearClient([issue]);
    const entityMapRepo = mockEntityMapRepo();
    const defconClient = mockDefconClient();
    const ingestor = new Ingestor(entityMapRepo, defconClient);

    const poller = new LinearPoller({
      linearClient,
      ingestor,
      watches: [
        { id: "watch-1", sourceId: "linear-main", flowName: "wopr-changeset", filter: { state: "Todo" } },
      ],
    });

    await poller.pollOnce();

    expect(entityMapRepo.insertIfAbsent).toHaveBeenCalled();
  });

  it("start/stop controls the poll interval", async () => {
    vi.useFakeTimers();
    const linearClient = mockLinearClient([]);
    const entityMapRepo = mockEntityMapRepo();
    const defconClient = mockDefconClient();
    const ingestor = new Ingestor(entityMapRepo, defconClient);

    const poller = new LinearPoller({
      linearClient,
      ingestor,
      watches: [],
      intervalMs: 5000,
    });

    poller.start();
    expect(linearClient.searchIssues).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    // no watches = no calls
    expect(linearClient.searchIssues).toHaveBeenCalledTimes(0);

    poller.stop();
    vi.useRealTimers();
  });
});
