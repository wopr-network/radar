import type { Router } from "../router.js";
import type { Watch, WatchRepo } from "../types.js";

export function registerWatchRoutes(router: Router, watchRepo: WatchRepo): void {
  router.add("GET", "/api/sources/:id/watches", async (ctx) => {
    const watches = await watchRepo.findBySourceId(ctx.params.id);
    return { status: 200, body: watches };
  });

  router.add("POST", "/api/sources/:id/watches", async (ctx) => {
    const data = ctx.body as Partial<Watch>;
    if (!data.name || !data.action) {
      return { status: 400, body: { error: "name and action are required" } };
    }
    const watch = await watchRepo.create({
      source_id: ctx.params.id,
      name: data.name,
      filter: data.filter ?? {},
      action: data.action,
      action_config: data.action_config ?? {},
      enabled: data.enabled ?? true,
    });
    return { status: 201, body: watch };
  });

  router.add("GET", "/api/watches/:id", async (ctx) => {
    const watch = await watchRepo.findById(ctx.params.id);
    if (!watch) return { status: 404, body: { error: "Watch not found" } };
    return { status: 200, body: watch };
  });

  router.add("PUT", "/api/watches/:id", async (ctx) => {
    const updated = await watchRepo.update(ctx.params.id, ctx.body as Partial<Watch>);
    if (!updated) return { status: 404, body: { error: "Watch not found" } };
    return { status: 200, body: updated };
  });

  router.add("DELETE", "/api/watches/:id", async (ctx) => {
    const deleted = await watchRepo.delete(ctx.params.id);
    if (!deleted) return { status: 404, body: { error: "Watch not found" } };
    return { status: 200, body: { deleted: true } };
  });
}
