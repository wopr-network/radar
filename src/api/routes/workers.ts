import type { Router } from "../router.js";
import type { IWorkerRepo } from "../types.js";

export function registerWorkerRoutes(router: Router, repo: IWorkerRepo): void {
  router.add("GET", "/api/workers", async () => {
    const workers = repo.list();
    return { status: 200, body: workers };
  });

  router.add("POST", "/api/workers", async (ctx) => {
    if (ctx.body === null || typeof ctx.body !== "object") {
      return { status: 400, body: { error: "Request body must be a JSON object" } };
    }
    const data = ctx.body as Record<string, unknown>;
    if (typeof data.name !== "string" || typeof data.type !== "string" || typeof data.discipline !== "string") {
      return { status: 400, body: { error: "name, type, and discipline are required" } };
    }
    const worker = repo.register({
      name: data.name,
      type: data.type,
      discipline: data.discipline,
      config: (data.config as Record<string, unknown>) ?? undefined,
    });
    return { status: 201, body: worker };
  });

  router.add("DELETE", "/api/workers/:id", async (ctx) => {
    const existing = repo.getById(ctx.params.id);
    if (!existing) return { status: 404, body: { error: "Worker not found" } };
    repo.deregister(ctx.params.id);
    return { status: 200, body: { deleted: true } };
  });

  router.add("POST", "/api/workers/:id/heartbeat", async (ctx) => {
    const existing = repo.getById(ctx.params.id);
    if (!existing) return { status: 404, body: { error: "Worker not found" } };
    repo.heartbeat(ctx.params.id);
    return { status: 200, body: { ok: true } };
  });
}
