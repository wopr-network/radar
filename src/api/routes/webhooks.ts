import { getSignatureHeader, verifyWebhookSignature } from "../hmac.js";
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

    const secret = typeof source.config.secret === "string" ? source.config.secret : undefined;

    if (secret) {
      const headerName = getSignatureHeader(source);
      const headerValue = ctx.headers[headerName];
      const sig = Array.isArray(headerValue) ? headerValue[0] : headerValue;

      const result = verifyWebhookSignature(ctx.rawBody, secret, sig);
      if (!result.valid) {
        return { status: 401, body: { error: result.error } };
      }
    }

    await onWebhook(ctx.params.sourceId, ctx.body);
    return { status: 200, body: { accepted: true } };
  });
}
