import { describe, expect, it, vi } from "vitest";
import type { IEntityActivityRepo } from "../db/repos/entity-activity-repo.js";
import type { LaunchedContainer } from "./container-launcher.js";
import { NukeDispatcher } from "./nuke-dispatcher.js";
import type { NukeEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRepo(): IEntityActivityRepo {
  return {
    insert: vi
      .fn()
      .mockResolvedValue({ id: "x", entityId: "e1", slotId: "s1", seq: 0, type: "start", data: {}, createdAt: 0 }),
    getByEntity: vi.fn().mockResolvedValue([]),
    getSummary: vi.fn().mockResolvedValue(""),
    deleteByEntity: vi.fn().mockResolvedValue(undefined),
  };
}

/** Builds a fake LaunchedContainer whose SSE stream yields the given events. */
function makeLaunched(events: NukeEvent[], baseUrl = "http://127.0.0.1:9999"): LaunchedContainer {
  const teardown = vi.fn().mockResolvedValue(undefined);

  // Encode events as a real SSE response body so SseEventEmitter can parse them
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

  // Patch global fetch for the duration of each test
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let done = false;
          return {
            read: async () => {
              if (done) return { done: true, value: undefined };
              done = true;
              return { done: false, value: new TextEncoder().encode(body) };
            },
          };
        },
      },
    }),
  );

  return { baseUrl, teardown };
}

interface FakeContainer {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
  id: string;
}

interface FakeDocker {
  createContainer: ReturnType<typeof vi.fn>;
}

function makeDockerode(events: NukeEvent[]): FakeDocker {
  const container: FakeContainer = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({
      NetworkSettings: { Ports: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "9999" }] } },
    }),
    id: "fakeid123",
  };
  makeLaunched(events); // stubs fetch
  return { createContainer: vi.fn().mockResolvedValue(container) };
}

function makeNuke(events: NukeEvent[], repo = makeRepo()): { dispatcher: NukeDispatcher; repo: IEntityActivityRepo } {
  const docker = makeDockerode(events);
  const dispatcher = new NukeDispatcher(repo, {
    disciplineImages: { coder: "ghcr.io/wopr-network/wopr-nuke-coder:latest" },
    secretsDir: "/tmp/nuke-secrets",
    docker: docker as never,
  });
  return { dispatcher, repo };
}

const SUCCESS: NukeEvent = {
  type: "result",
  subtype: "success",
  isError: false,
  stopReason: "end_turn",
  costUsd: 0.002,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NukeDispatcher", () => {
  it("inserts start activity row before dispatching", async () => {
    const { dispatcher, repo } = makeNuke([SUCCESS]);
    await dispatcher.dispatch("do work", { entityId: "e1", workerId: "s1", modelTier: "haiku", agentRole: "coder" });
    expect(repo.insert).toHaveBeenCalledWith(expect.objectContaining({ type: "start" }));
  });

  it("returns WorkerResult from processEvents on success", async () => {
    const { dispatcher } = makeNuke([
      { type: "text", text: "PR created: https://github.com/wopr-network/radar/pull/77" },
      SUCCESS,
    ]);
    const result = await dispatcher.dispatch("do work", {
      entityId: "e1",
      workerId: "s1",
      modelTier: "sonnet",
      agentRole: "coder",
    });
    expect(result.signal).toBe("pr_created");
    expect(result.exitCode).toBe(0);
  });

  it("returns crash and logs error when container launch fails", async () => {
    const repo = makeRepo();
    const docker = {
      createContainer: vi.fn().mockRejectedValue(new Error("image not found")),
    } as FakeDocker;

    const dispatcher = new NukeDispatcher(repo, {
      disciplineImages: { coder: "bad-image" },
      secretsDir: "/tmp",
      docker: docker as never,
    });

    const result = await dispatcher.dispatch("work", {
      entityId: "e1",
      workerId: "s1",
      modelTier: "haiku",
      agentRole: "coder",
    });
    expect(result.signal).toBe("crash");
    expect(result.exitCode).toBe(-1);
    expect(result.artifacts).toMatchObject({ error: "image not found" });
  });

  it("always calls teardown even when processEvents throws", async () => {
    const repo = makeRepo();
    const teardown = vi.fn().mockResolvedValue(undefined);

    const container: FakeContainer = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      inspect: vi.fn().mockResolvedValue({
        NetworkSettings: { Ports: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "9998" }] } },
      }),
      id: "teardown-test",
    };

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const docker = { createContainer: vi.fn().mockResolvedValue(container) } as FakeDocker;

    // Spy on ContainerLauncher to inject our teardown mock
    const { ContainerLauncher } = await import("./container-launcher.js");
    const origLaunch = ContainerLauncher.prototype.launch;
    ContainerLauncher.prototype.launch = vi.fn().mockResolvedValue({
      baseUrl: "http://127.0.0.1:9998",
      teardown,
    });

    const dispatcher = new NukeDispatcher(repo, {
      disciplineImages: { coder: "img" },
      secretsDir: "/tmp",
      docker: docker as never,
    });

    await dispatcher.dispatch("work", { entityId: "e1", workerId: "s1", modelTier: "haiku", agentRole: "coder" });

    expect(teardown).toHaveBeenCalled();

    // Restore
    ContainerLauncher.prototype.launch = origLaunch;
  });

  it("continues if start activity insert fails", async () => {
    const repo = makeRepo();
    vi.mocked(repo.insert).mockRejectedValueOnce(new Error("db error"));

    const docker = makeDockerode([SUCCESS]);
    const dispatcher = new NukeDispatcher(repo, {
      disciplineImages: { coder: "img" },
      secretsDir: "/tmp",
      docker: docker as never,
    });

    const result = await dispatcher.dispatch("work", {
      entityId: "e1",
      workerId: "s1",
      modelTier: "haiku",
      agentRole: "coder",
    });
    expect(result.signal).toBeDefined();
  });

  it("uses agentRole as discipline for image lookup", async () => {
    const repo = makeRepo();
    const docker = makeDockerode([SUCCESS]);

    const dispatcher = new NukeDispatcher(repo, {
      disciplineImages: {
        coder: "ghcr.io/wopr-network/wopr-nuke-coder:latest",
        devops: "ghcr.io/wopr-network/wopr-nuke-devops:latest",
      },
      secretsDir: "/tmp",
      docker: docker as never,
    });

    await dispatcher.dispatch("work", { entityId: "e1", workerId: "s1", modelTier: "haiku", agentRole: "devops" });

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: "ghcr.io/wopr-network/wopr-nuke-devops:latest" }),
    );
  });
});
