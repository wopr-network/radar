import type { IngestEvent } from "../../ingestion/types.js";
import { extractRepoFromDescription } from "./repo-extractor.js";

export interface WebhookWatchConfig {
  sourceId: string;
  flowName: string;
  filter: { state?: string; labels?: string[] };
}

export function handleLinearWebhook(payload: unknown, watch: WebhookWatchConfig): IngestEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;

  if (p.type !== "Issue") return null;

  const data = p.data as Record<string, unknown> | undefined;
  if (!data) return null;

  const state = data.state as { name?: string; type?: string } | undefined;
  if (watch.filter.state && state?.name !== watch.filter.state) return null;

  const labels = data.labels as Array<{ name: string }> | undefined;
  if (watch.filter.labels && watch.filter.labels.length > 0) {
    const issueLabels = new Set((labels ?? []).map((l) => l.name));
    if (!watch.filter.labels.some((l) => issueLabels.has(l))) return null;
  }

  const description = (data.description as string) ?? null;
  const repo = extractRepoFromDescription(description);

  return {
    sourceId: watch.sourceId,
    externalId: data.id as string,
    type: "new",
    flowName: watch.flowName,
    payload: {
      refs: {
        linear: {
          id: data.id as string,
          key: data.identifier as string,
          title: data.title as string,
          description,
        },
        github: { repo },
      },
    },
  };
}
