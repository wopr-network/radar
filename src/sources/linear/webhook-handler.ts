import { z } from "zod/v4";
import type { IngestEvent } from "../../ingestion/types.js";
import { extractRepoFromDescription } from "./repo-extractor.js";

export interface WebhookWatchConfig {
  sourceId: string;
  flowName: string;
  filter: { state?: string; labels?: string[] };
}

const LinearWebhookPayloadSchema = z.object({
  action: z.enum(["create", "update", "remove"]),
  type: z.string(),
  data: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    state: z.object({ name: z.string(), type: z.string() }).optional(),
    labels: z.array(z.object({ name: z.string() })).optional(),
  }),
});

export function handleLinearWebhook(payload: unknown, watch: WebhookWatchConfig): IngestEvent | null {
  const parsed = LinearWebhookPayloadSchema.safeParse(payload);
  if (!parsed.success) return null;

  const p = parsed.data;

  if (p.type !== "Issue") return null;

  // Only process create/update events; "remove" means the issue was deleted or left the state.
  if (p.action === "remove") return null;

  const data = p.data;

  if (watch.filter.state && data.state?.name !== watch.filter.state) return null;

  if (watch.filter.labels && watch.filter.labels.length > 0) {
    const issueLabels = new Set((data.labels ?? []).map((l) => l.name));
    if (!watch.filter.labels.some((l) => issueLabels.has(l))) return null;
  }

  const description = data.description ?? null;
  const repo = extractRepoFromDescription(description);

  return {
    sourceId: watch.sourceId,
    externalId: data.id,
    type: "new",
    flowName: watch.flowName,
    payload: {
      refs: {
        linear: {
          id: data.id,
          key: data.identifier,
          title: data.title,
          description,
        },
        github: { repo },
      },
    },
  };
}
