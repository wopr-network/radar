import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Mock child_process before NukeDispatcher is imported so launchContainer
 * uses our mock execFile instead of the real one.
 */
let mockPort = 0;

vi.mock("node:child_process", () => {
  return {
    execFile: (
      _cmd: string,
      args: string[],
      cb: (err: Error | null, result: { stdout: string; stderr: string }) => void,
    ) => {
      const proc = { pid: 1, stdout: null, stderr: null, stdin: null, kill: () => false };
      if (args?.[0] === "run") {
        cb(null, { stdout: `fake-cid-${Date.now()}\n`, stderr: "" });
        return proc;
      }
      if (args?.[0] === "inspect") {
        const inspect = [{ NetworkSettings: { Ports: { "8080/tcp": [{ HostPort: String(mockPort) }] } } }];
        cb(null, { stdout: JSON.stringify(inspect), stderr: "" });
        return proc;
      }
      if (args?.[0] === "rm") {
        cb(null, { stdout: "", stderr: "" });
        return proc;
      }
      cb(new Error(`unexpected: ${args?.join(" ")}`), { stdout: "", stderr: "" });
      return proc;
    },
  };
});

// Import after mock is set up
const { NukeDispatcher } = await import("./nuke-dispatcher.js");

function sseLines(events: Array<{ type: string; [k: string]: unknown }>): string {
  return `${events.map((e) => `data: ${JSON.stringify(e)}\n`).join("\n")}\n`;
}

describe("NukeDispatcher SSE parsing", () => {
  let server: Server;
  let sseResponse: string;
  const mockRepo = {
    insert: vi.fn().mockResolvedValue(undefined),
    getByEntity: vi.fn().mockResolvedValue([]),
    getSummary: vi.fn().mockResolvedValue(""),
    deleteByEntity: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    sseResponse = "";
    server = createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200);
        res.end("ok");
        return;
      }
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(sseResponse);
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    mockPort = typeof addr === "object" && addr ? addr.port : 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("inserts start activity row before dispatch", async () => {
    sseResponse = sseLines([{ type: "result", signal: "done", artifacts: {}, isError: false }]);

    const entityId = `start-test-${Date.now()}`;
    const dispatcher = new NukeDispatcher(mockRepo, { image: "mock" });
    await dispatcher.dispatch("test", { entityId, workerId: "w-1", modelTier: "sonnet" });
    await dispatcher.stopEntity(entityId);

    const types = mockRepo.insert.mock.calls.map((c: Array<{ type: string }>) => c[0]?.type);
    expect(types).toContain("start");
    expect(types).toContain("result");
    expect(types.indexOf("start")).toBeLessThan(types.indexOf("result"));

    const startCall = mockRepo.insert.mock.calls.find((c: Array<{ type: string }>) => c[0]?.type === "start");
    expect(startCall).toBeDefined();
    expect(startCall?.[0]).toEqual(
      expect.objectContaining({
        entityId,
        type: "start",
        data: { modelTier: "sonnet" },
      }),
    );
  });

  it("error event breaks read loop — result after error is ignored", async () => {
    sseResponse = sseLines([
      { type: "error", message: "container crashed" },
      { type: "result", signal: "done", artifacts: { shouldNot: "appear" }, isError: false },
    ]);

    const entityId = `error-test-${Date.now()}`;
    const dispatcher = new NukeDispatcher(mockRepo, { image: "mock" });
    const result = await dispatcher.dispatch("test", {
      entityId,
      workerId: "w-1",
      modelTier: "sonnet",
    });
    await dispatcher.stopEntity(entityId);

    expect(result.signal).toBe("crash");
    expect(result.artifacts).toEqual({ error: "container crashed" });
    expect(result.exitCode).toBe(-1);
    // Result event after error must NOT have been processed
    expect(result.artifacts).not.toHaveProperty("shouldNot");

    // No "result" activity row should exist — only start
    const resultInserts = mockRepo.insert.mock.calls.filter((c: Array<{ type: string }>) => c[0]?.type === "result");
    expect(resultInserts).toHaveLength(0);
  });
});
