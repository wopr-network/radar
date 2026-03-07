import type { DefconClient } from "../defcon/index.js";
import type { Pool } from "../pool/index.js";

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
  pool: Pool;
  defconClient: DefconClient;
  onWebhook: (sourceId: string, payload: unknown) => Promise<void>;
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

export interface WorkerRepo {
  findAll(): Promise<Worker[]>;
  findById(id: string): Promise<Worker | undefined>;
  create(data: Omit<Worker, "id" | "created_at">): Promise<Worker>;
  delete(id: string): Promise<boolean>;
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

export interface Worker {
  id: string;
  name: string;
  type: string;
  discipline: string;
  status: string;
  config: Record<string, unknown> | null;
  last_heartbeat: number;
  created_at: number;
}
