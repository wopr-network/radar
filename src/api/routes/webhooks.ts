import type { Router } from "../router.js";
import type { SourceRepo } from "../types.js";

export function registerWebhookRoutes(
  router: Router,
  sourceRepo: SourceRepo,
  onWebhook: (sourceId: string, payload: unknown) => Promise<void>,
): void {
  router.add("POST", "/webhooks/:sourceId", async (ctx) => {
    const source = await sourceRepo.findById(ctx.params.sourceId);
    if (!source) return { status: 404, body: { error: "Source not found" } };
    if (!source.enabled) return { status: 400, body: { error: "Source is disabled" } };

    await onWebhook(ctx.params.sourceId, ctx.body);
    return { status: 200, body: { accepted: true } };
  });
}
