import type { IEntityActivityRepo } from "../db/repos/i-entity-activity-repo.js";
import type { RegisterWorkerInput, WorkerRepo, WorkerRow } from "../db/repos/worker-repo.js";
import type { DefconClient } from "../defcon/index.js";
import type { IngestEvent } from "../ingestion/types.js";
import type { Pool } from "../pool/index.js";
import type { SourceAdapterRegistry } from "../sources/adapter.js";

export type { WorkerRepo, WorkerRow, RegisterWorkerInput };

export interface RouteParams {
  [key: string]: string;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

export type RouteHandler = (ctx: RouteContext) => Promise<RouteResult>;

export interface RouteContext {
  params: RouteParams;
  body: unknown;
  rawBody: string;
  headers: Record<string, string | string[] | undefined>;
  query: URLSearchParams;
}

export interface RouteDefinition {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: RouteHandler;
}

export interface AppDeps {
  sourceRepo: SourceRepo;
  watchRepo: WatchRepo;
  eventLogRepo: EventLogRepo;
  workerRepo: WorkerRepo;
  activityRepo: IEntityActivityRepo;
  pool: Pool;
  defconClient: DefconClient;
  adapterRegistry: SourceAdapterRegistry;
  onWebhook: (sourceId: string, event: IngestEvent) => Promise<void>;
}

export interface SourceRepo {
  findAll(): Promise<Source[]>;
  findById(id: string): Promise<Source | undefined>;
  create(data: Omit<Source, "id" | "created_at" | "updated_at">): Promise<Source>;
  update(id: string, data: Partial<Source>): Promise<Source | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface WatchRepo {
  findBySourceId(sourceId: string): Promise<Watch[]>;
  findById(id: string): Promise<Watch | undefined>;
  create(data: Omit<Watch, "id" | "created_at" | "updated_at">): Promise<Watch>;
  update(id: string, data: Partial<Watch>): Promise<Watch | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface EventLogRepo {
  findAll(opts?: { limit?: number; offset?: number }): Promise<EventLogEntry[]>;
  append(data: Omit<EventLogEntry, "id" | "created_at">): Promise<EventLogEntry>;
}

export interface Source {
  id: string;
  name: string;
  type: string;
  config: Record<string, unknown>;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface Watch {
  id: string;
  source_id: string;
  name: string;
  filter: Record<string, unknown>;
  action: string;
  action_config: Record<string, unknown>;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

export interface EventLogEntry {
  id: string;
  source_id: string;
  watch_id: string | null;
  raw_event: unknown;
  action_taken: string | null;
  defcon_response: unknown;
  created_at: number;
}
