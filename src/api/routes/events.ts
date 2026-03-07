import type { Router } from "../router.js";
import type { EventLogRepo } from "../types.js";

export function registerEventRoutes(router: Router, repo: EventLogRepo): void {
  router.add("GET", "/api/events", async (ctx) => {
    const rawLimit = parseInt(ctx.query.get("limit") ?? "", 10);
    const rawOffset = parseInt(ctx.query.get("offset") ?? "", 10);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? rawLimit : 50;
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    const events = await repo.findAll({ limit, offset });
    return { status: 200, body: events };
  });
}
