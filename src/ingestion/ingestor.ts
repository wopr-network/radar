import type { IEntityMapRepository } from "../db/repos/entity-map-repo.js";
import type { DefconClient } from "../defcon/client.js";
import { type IngestEvent, IngestEventSchema } from "./types.js";

export interface IngestorConfig {
  workerId?: string;
}

export class Ingestor {
  private entityMapRepo: IEntityMapRepository;
  private defcon: DefconClient;
  private workerId: string;

  constructor(entityMapRepo: IEntityMapRepository, defcon: DefconClient, config: IngestorConfig = {}) {
    this.entityMapRepo = entityMapRepo;
    this.defcon = defcon;
    this.workerId = config.workerId ?? "norad";
  }

  async ingest(raw: unknown): Promise<void> {
    const event = IngestEventSchema.parse(raw);

    if (event.type === "new") {
      await this.handleNew(event);
    } else {
      await this.handleUpdate(event);
    }
  }

  private async handleNew(event: IngestEvent): Promise<void> {
    const existing = this.entityMapRepo.findEntityId(event.sourceId, event.externalId);
    if (existing !== undefined) {
      return;
    }

    const response = await this.defcon.createEntity({
      flowName: event.flowName,
      payload: event.payload ?? {},
    });

    this.entityMapRepo.insertIfAbsent(event.sourceId, event.externalId, response.entityId);
  }

  private async handleUpdate(event: IngestEvent): Promise<void> {
    const entityId = this.entityMapRepo.findEntityId(event.sourceId, event.externalId);
    if (entityId === undefined) {
      return;
    }

    await this.defcon.report({
      workerId: this.workerId,
      entityId,
      signal: event.signal ?? "update",
      artifacts: event.payload ?? {},
    });
  }
}
