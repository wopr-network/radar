import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SseEventEmitter } from "./sse-event-emitter.js";
import type { NukeEvent } from "./types.js";

function sse(events: object[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

function startServer(handler: (body: unknown) => object[]): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/dispatch") {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as unknown;
          res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
          res.end(sse(handler(body)));
        });
      } else {
        res.writeHead(404).end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  ({ url: baseUrl, server } = await startServer(() => [
    { type: "system", subtype: "init" },
    { type: "text", text: "working..." },
    { type: "result", subtype: "success", isError: false, stopReason: "end_turn", costUsd: 0.001 },
  ]));
});

afterEach(async () => {
  await stopServer(server);
});

async function collect(emitter: SseEventEmitter): Promise<NukeEvent[]> {
  const events: NukeEvent[] = [];
  for await (const e of emitter.events()) events.push(e);
  return events;
}

describe("SseEventEmitter", () => {
  it("yields all NukeEvents from the SSE stream", async () => {
    const events = await collect(new SseEventEmitter({ baseUrl, prompt: "work", modelTier: "haiku" }));
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "system", subtype: "init" });
    expect(events[1]).toEqual({ type: "text", text: "working..." });
    expect(events[2]).toMatchObject({ type: "result", subtype: "success" });
  });

  it("sends prompt and modelTier in the POST body", async () => {
    let captured: unknown;
    const { url, server: s } = await startServer((body) => {
      captured = body;
      return [{ type: "result", subtype: "success", isError: false, stopReason: "end_turn", costUsd: 0 }];
    });

    try {
      await collect(new SseEventEmitter({ baseUrl: url, prompt: "do work", modelTier: "opus" }));
      expect(captured).toMatchObject({ prompt: "do work", modelTier: "opus" });
    } finally {
      await stopServer(s);
    }
  });

  it("includes sessionId in body when provided", async () => {
    let captured: unknown;
    const { url, server: s } = await startServer((body) => {
      captured = body;
      return [{ type: "result", subtype: "success", isError: false, stopReason: "end_turn", costUsd: 0 }];
    });

    try {
      await collect(new SseEventEmitter({ baseUrl: url, prompt: "work", modelTier: "haiku", sessionId: "sess-1" }));
      expect(captured).toMatchObject({ sessionId: "sess-1" });
    } finally {
      await stopServer(s);
    }
  });

  it("silently skips unknown event types", async () => {
    const { url, server: s } = await startServer(() => [
      { type: "unknown_future_event", data: "x" },
      { type: "result", subtype: "success", isError: false, stopReason: "end_turn", costUsd: 0 },
    ]);

    try {
      const events = await collect(new SseEventEmitter({ baseUrl: url, prompt: "work", modelTier: "haiku" }));
      expect(events.every((e) => (e as { type: string }).type !== "unknown_future_event")).toBe(true);
      expect(events.some((e) => e.type === "result")).toBe(true);
    } finally {
      await stopServer(s);
    }
  });

  it("throws when server returns non-200", async () => {
    const { url, server: s } = await startServer(() => {
      throw new Error("unreachable");
    });
    // Replace handler to return 500
    s.removeAllListeners("request");
    s.on("request", (_req, res) => res.writeHead(500).end("internal error"));

    try {
      await expect(collect(new SseEventEmitter({ baseUrl: url, prompt: "work", modelTier: "haiku" }))).rejects.toThrow(
        "500",
      );
    } finally {
      await stopServer(s);
    }
  });

  it("aborts on timeout", async () => {
    const { url, server: s } = await startServer(() => []);
    // Replace handler to hang
    s.removeAllListeners("request");
    s.on("request", (_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      // never ends
    });

    try {
      await expect(
        collect(new SseEventEmitter({ baseUrl: url, prompt: "work", modelTier: "haiku", timeoutMs: 50 })),
      ).rejects.toThrow();
    } finally {
      await stopServer(s);
    }
  });
});
