import { z } from "zod/v4";
import type { IngestEvent } from "../../ingestion/types.js";
import { extractRepoFromDescription } from "./repo-extractor.js";

export interface WebhookWatchConfig {
  sourceId: string;
  flowName: string;
  filter: { state?: string; labels?: string[]; stateId?: string; labelIds?: string[] };
}

const LinearWebhookPayloadSchema = z.object({
  action: z.enum(["create", "update", "remove"]),
  type: z.string(),
  data: z.object({
    id: z.string(),
    identifier: z.string(),
    title: z.string(),
    description: z.string().nullable().optional(),
    // Nested-object format (used in some contexts)
    state: z.object({ name: z.string(), type: z.string() }).optional(),
    labels: z.array(z.object({ name: z.string() })).optional(),
    // Flat ID format (real Linear webhook payloads)
    stateId: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
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

  // Filter by stateId (flat ID format from real webhooks)
  if (watch.filter.stateId && data.stateId !== watch.filter.stateId) return null;

  // Filter by state name (nested-object format)
  if (watch.filter.state && data.state?.name !== watch.filter.state) return null;

  // Filter by labelIds (flat ID format from real webhooks)
  if (watch.filter.labelIds && watch.filter.labelIds.length > 0) {
    const issueLabels = new Set(data.labelIds ?? []);
    if (!watch.filter.labelIds.some((id) => issueLabels.has(id))) return null;
  }

  // Filter by label names (nested-object format)
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
