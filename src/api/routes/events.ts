import type { Router } from "../router.js";
import type { EventLogRepo } from "../types.js";

export function registerEventRoutes(router: Router, repo: EventLogRepo): void {
  router.add("GET", "/api/events", async (ctx) => {
    const limit = ctx.query.has("limit") ? parseInt(ctx.query.get("limit") as string, 10) : 50;
    const offset = ctx.query.has("offset") ? parseInt(ctx.query.get("offset") as string, 10) : 0;
    const events = await repo.findAll({ limit, offset });
    return { status: 200, body: events };
  });
}
