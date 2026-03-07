import type { Router } from "../router.js";
import type { Worker, WorkerRepo } from "../types.js";

export function registerWorkerRoutes(router: Router, repo: WorkerRepo): void {
  router.add("GET", "/api/workers", async () => {
    const workers = await repo.findAll();
    return { status: 200, body: workers };
  });

  router.add("POST", "/api/workers", async (ctx) => {
    if (ctx.body === null || typeof ctx.body !== "object") {
      return { status: 400, body: { error: "Request body must be a JSON object" } };
    }
    const data = ctx.body as Partial<Worker>;
    if (!data.name || !data.type || !data.discipline) {
      return { status: 400, body: { error: "name, type, and discipline are required" } };
    }
    const worker = await repo.create({
      name: data.name,
      type: data.type,
      discipline: data.discipline,
      status: data.status ?? "idle",
      config: data.config ?? null,
      last_heartbeat: Date.now(),
    });
    return { status: 201, body: worker };
  });

  router.add("DELETE", "/api/workers/:id", async (ctx) => {
    const deleted = await repo.delete(ctx.params.id);
    if (!deleted) return { status: 404, body: { error: "Worker not found" } };
    return { status: 200, body: { deleted: true } };
  });
}
