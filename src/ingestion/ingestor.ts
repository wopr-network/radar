import type { NoradDb } from "../db/index.js";
import type { DefconClient } from "../defcon/client.js";
import { type IngestEvent, IngestEventSchema } from "./types.js";

export class Ingestor {
  private db: NoradDb;
  private defcon: DefconClient;

  constructor(db: NoradDb, defcon: DefconClient) {
    this.db = db;
    this.defcon = defcon;
  }

  async ingest(raw: unknown): Promise<void> {
    const event = IngestEventSchema.parse(raw);
    const key = `${event.sourceId}:${event.externalId}`;

    if (event.type === "new") {
      await this.handleNew(key, event);
    } else {
      await this.handleUpdate(key, event);
    }
  }

  private async handleNew(key: string, event: IngestEvent): Promise<void> {
    const existing = this.lookupEntityId(key);
    if (existing !== undefined) {
      return;
    }

    const response = await this.defcon.createEntity({
      flowName: event.flowName,
      payload: event.payload ?? {},
    });

    this.storeEntityId(key, response.entityId);
  }

  private async handleUpdate(key: string, event: IngestEvent): Promise<void> {
    const entityId = this.lookupEntityId(key);
    if (entityId === undefined) {
      return;
    }

    await this.defcon.report({
      workerId: "norad",
      entityId,
      signal: event.signal ?? "update",
      artifacts: event.payload,
    });
  }

  private lookupEntityId(key: string): string | undefined {
    const client = this.db.$client;
    const row = client.prepare("SELECT entity_id FROM entity_map WHERE id = ?").get(key) as
      | { entity_id: string }
      | undefined;
    return row?.entity_id;
  }

  private storeEntityId(key: string, entityId: string): void {
    const client = this.db.$client;
    client
      .prepare("INSERT OR REPLACE INTO entity_map (id, entity_id, created_at) VALUES (?, ?, ?)")
      .run(key, entityId, Date.now());
  }
}
