import { getSignatureHeader, verifyWebhookSignature } from "../api/hmac.js";
import type { Source, Watch } from "../api/types.js";
import type { IngestEvent } from "../ingestion/types.js";
import type { SourceAdapter } from "./adapter.js";

export class GenericSourceAdapter implements SourceAdapter {
  readonly type = "webhook";

  parseEvent(payload: unknown, source: Source, watches: Watch[]): IngestEvent | null {
    const watch = watches.find((w) => w.enabled);
    if (!watch) return null;

    const flowName = typeof watch.action_config.flowName === "string" ? watch.action_config.flowName : undefined;
    if (!flowName) return null;

    const p = payload as Record<string, unknown>;
    const externalId = typeof p?.id === "string" ? p.id : `${source.id}-${Date.now()}`;

    return {
      sourceId: source.id,
      externalId,
      type: "new",
      flowName,
      payload: typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : {},
    };
  }

  verifySignature(
    rawBody: string,
    source: Source,
    headers: Record<string, string | string[] | undefined>,
  ): { valid: boolean; error?: string } {
    const secret =
      typeof source.config.secret === "string" && source.config.secret.length > 0 ? source.config.secret : undefined;
    if (!secret) return { valid: true };

    const headerName = getSignatureHeader(source);
    const headerValue = headers[headerName];
    const sig = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    return verifyWebhookSignature(rawBody, secret, sig);
  }
}
