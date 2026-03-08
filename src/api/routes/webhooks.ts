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
    if (!adapter) return { status: 400, body: { error: "No adapter registered for source" } };

    let sigResult: { valid: boolean; error?: string };
    try {
      sigResult = adapter.verifySignature(ctx.rawBody, source, ctx.headers);
    } catch {
      return { status: 400, body: { error: "Signature verification failed" } };
    }
    if (!sigResult.valid) return { status: 401, body: { error: "Unauthorized" } };

    const watches = await watchRepo.findBySourceId(source.id);
    let event: import("../../ingestion/types.js").IngestEvent | null;
    try {
      event = adapter.parseEvent(ctx.body, source, watches);
    } catch {
      return { status: 400, body: { error: "Failed to parse event" } };
    }

    if (event !== null && event !== undefined) {
      await onWebhook(ctx.params.sourceId, event);
      return { status: 200, body: { accepted: true } };
    }

    return { status: 200, body: { accepted: false } };
  });
}
