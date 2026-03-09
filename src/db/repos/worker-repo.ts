import { eq } from "drizzle-orm";
import type { IWorkerRepo } from "../../api/types.js";
import type { RadarDb } from "../index.js";
import { workers } from "../schema.js";

export interface RegisterWorkerInput {
  name: string;
  type: string;
  discipline: string;
  config?: Record<string, unknown>;
}

export interface WorkerRow {
  id: string;
  name: string;
  type: string;
  discipline: string;
  status: string;
  config: Record<string, unknown> | null;
  lastHeartbeat: number;
  createdAt: number;
}

function toRow(raw: typeof workers.$inferSelect): WorkerRow {
  return {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    discipline: raw.discipline,
    status: raw.status,
    config: raw.config ? (JSON.parse(raw.config) as Record<string, unknown>) : null,
    lastHeartbeat: raw.lastHeartbeat,
    createdAt: raw.createdAt,
  };
}

export class WorkerRepo implements IWorkerRepo {
  constructor(private db: RadarDb) {}

  register(input: RegisterWorkerInput): Promise<WorkerRow> {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    this.db
      .insert(workers)
      .values({
        id,
        name: input.name,
        type: input.type,
        discipline: input.discipline,
        status: "idle",
        config: input.config ? JSON.stringify(input.config) : null,
        lastHeartbeat: now,
        createdAt: now,
      })
      .run();
    const row = this.db.select().from(workers).where(eq(workers.id, id)).get();
    if (!row) throw new Error("Insert failed");
    return Promise.resolve(toRow(row));
  }

  deregister(id: string): Promise<void> {
    this.db.delete(workers).where(eq(workers.id, id)).run();
    return Promise.resolve();
  }

  heartbeat(id: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const row = this.db.select().from(workers).where(eq(workers.id, id)).get();
    if (!row) throw new Error(`Unknown worker: ${id}`);
    this.db.update(workers).set({ lastHeartbeat: now }).where(eq(workers.id, id)).run();
    return Promise.resolve();
  }

  setStatus(id: string, status: string): Promise<void> {
    const row = this.db.select().from(workers).where(eq(workers.id, id)).get();
    if (!row) throw new Error(`Worker ${id} not found`);
    this.db.update(workers).set({ status }).where(eq(workers.id, id)).run();
    return Promise.resolve();
  }

  getById(id: string): Promise<WorkerRow | undefined> {
    const row = this.db.select().from(workers).where(eq(workers.id, id)).get();
    return Promise.resolve(row ? toRow(row) : undefined);
  }

  list(): Promise<WorkerRow[]> {
    return Promise.resolve(this.db.select().from(workers).all().map(toRow));
  }

  listByStatus(status: string): Promise<WorkerRow[]> {
    return Promise.resolve(this.db.select().from(workers).where(eq(workers.status, status)).all().map(toRow));
  }
}
