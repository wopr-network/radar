import type { IEntityActivityRepo } from "../../db/repos/i-entity-activity-repo.js";
import type { Router } from "../router.js";

export function registerActivityRoutes(router: Router, activityRepo: IEntityActivityRepo): void {
  router.add("GET", "/api/entities/:entityId/activity", async (ctx) => {
    const entityId = ctx.params.entityId;
    const rawSince = ctx.query.get("since");
    const since = rawSince !== null ? parseInt(rawSince, 10) : undefined;
    const items = activityRepo.getByEntity(entityId, since);
    const nextSeq = items.length > 0 ? (items[items.length - 1]?.seq ?? 0) + 1 : (since ?? 0);
    return { status: 200, body: { items, nextSeq } };
  });
}
