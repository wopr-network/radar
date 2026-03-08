import type { IngestEvent } from "../../ingestion/types.js";
import type { SourceAdapterRegistry } from "../../sources/adapter.js";
import type { Router } from "../router.js";
import type { SourceRepo, WatchRepo } from "../types.js";

export function registerWebhookRoutes(
  router: Router,
  sourceRepo: SourceRepo,
  watchRepo: WatchRepo,
  adapterRegistry: SourceAdapterRegistry,
  onWebhook: (sourceId: string, event: IngestEvent) => Promise<void>,
): void {
  router.add("POST", "/webhooks/:sourceId", async (ctx) => {
    const source = await sourceRepo.findById(ctx.params.sourceId);
    if (!source) return { status: 401, body: { error: "Unauthorized" } };
    if (!source.enabled) return { status: 401, body: { error: "Unauthorized" } };

    const adapter = adapterRegistry.get(source.type);
    if (!adapter) return { status: 400, body: { error: `No adapter for source type: ${source.type}` } };

    const sigResult = adapter.verifySignature(ctx.rawBody, source, ctx.headers);
    if (!sigResult.valid) return { status: 401, body: { error: "Unauthorized" } };

    const watches = await watchRepo.findBySourceId(source.id);
    const event = adapter.parseEvent(ctx.body, source, watches);

    if (event) {
      await onWebhook(ctx.params.sourceId, event);
      return { status: 200, body: { accepted: true } };
    }

    return { status: 200, body: { accepted: false } };
  });
}
