import { createServer as httpCreateServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Router } from "./router.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerPoolRoutes } from "./routes/pool.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerWatchRoutes } from "./routes/watches.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { registerWorkerRoutes } from "./routes/workers.js";
import type { AppDeps } from "./types.js";

const MAX_BODY_SIZE = 1024 * 1024; // 1MB

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        reject(Object.assign(new Error("Request body too large"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export function createServer(deps: AppDeps): Server {
  const router = new Router();

  registerWebhookRoutes(router, deps.sourceRepo, deps.watchRepo, deps.adapterRegistry, deps.onWebhook);
  registerSourceRoutes(router, deps.sourceRepo);
  registerWatchRoutes(router, deps.watchRepo);
  registerWorkerRoutes(router, deps.workerRepo);
  registerPoolRoutes(router, deps.pool, () => deps.defconClient.claim({ role: "engineering" }));
  registerEventRoutes(router, deps.eventLogRepo);

  const server = httpCreateServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const method = req.method ?? "GET";
      const rawBody = await readBody(req);

      const result = await router.handle(method, url.pathname, rawBody, url.searchParams, req.headers);

      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.body));
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: status === 413 ? "Request body too large" : "Internal server error" }));
    }
  });

  return server;
}
