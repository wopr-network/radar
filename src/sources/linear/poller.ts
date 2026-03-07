import type { Ingestor } from "../../ingestion/ingestor.js";
import type { LinearClient } from "./client.js";
import { extractRepoFromDescription } from "./repo-extractor.js";
import type { LinearSearchIssue } from "./types.js";

export interface LinearWatchConfig {
  id: string;
  sourceId: string;
  flowName: string;
  filter: { state?: string; labels?: string[] };
}

export interface LinearPollerConfig {
  linearClient: LinearClient;
  ingestor: Ingestor;
  watches: LinearWatchConfig[];
  intervalMs?: number;
}

export class LinearPoller {
  private linearClient: LinearClient;
  private ingestor: Ingestor;
  private watches: LinearWatchConfig[];
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  // In-flight guard: prevents concurrent poll runs from overlapping if a poll
  // takes longer than the interval.
  private isPolling = false;

  constructor(config: LinearPollerConfig) {
    this.linearClient = config.linearClient;
    this.ingestor = config.ingestor;
    this.watches = config.watches;
    this.intervalMs = config.intervalMs ?? 60_000;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.isPolling) return;
      this.pollOnce().catch((err) => {
        console.error("[LinearPoller] poll error:", err);
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async pollOnce(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await this._doPoll();
    } finally {
      this.isPolling = false;
    }
  }

  private async _doPoll(): Promise<void> {
    const byState = new Map<string | null, LinearWatchConfig[]>();
    for (const watch of this.watches) {
      const state = watch.filter.state ?? null;
      const existing = byState.get(state) ?? [];
      existing.push(watch);
      byState.set(state, existing);
    }

    for (const [stateName, watches] of byState) {
      let issues: LinearSearchIssue[];
      try {
        issues = await this.linearClient.searchIssues(stateName !== null ? { stateName } : {});
      } catch (err) {
        console.error(`[LinearPoller] Failed to fetch issues for state=${stateName ?? "all"}:`, err);
        continue;
      }

      for (const issue of issues) {
        for (const watch of watches) {
          if (!this.matchesFilter(issue, watch.filter)) continue;

          const repo = extractRepoFromDescription(issue.description);

          try {
            await this.ingestor.ingest({
              sourceId: watch.sourceId,
              externalId: issue.id,
              type: "new",
              flowName: watch.flowName,
              payload: {
                refs: {
                  linear: {
                    id: issue.id,
                    key: issue.identifier,
                    title: issue.title,
                    description: issue.description,
                  },
                  github: { repo },
                },
              },
            });
          } catch (err) {
            console.error(`[LinearPoller] Failed to ingest ${issue.identifier}:`, err);
          }
        }
      }
    }
  }

  private matchesFilter(issue: LinearSearchIssue, filter: { state?: string; labels?: string[] }): boolean {
    if (filter.state && issue.state.name !== filter.state) return false;

    if (filter.labels && filter.labels.length > 0) {
      const issueLabels = new Set(issue.labels.map((l) => l.name));
      const hasMatch = filter.labels.some((l) => issueLabels.has(l));
      if (!hasMatch) return false;
    }

    return true;
  }
}
