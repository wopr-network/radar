import type { IEntityMapRepository } from "../db/repos/entity-map-repo.js";
import type { DefconClient } from "../defcon/client.js";
import { type IngestEvent, IngestEventSchema } from "./types.js";

export class Ingestor {
  private entityMapRepo: IEntityMapRepository;
  private defcon: DefconClient;

  constructor(entityMapRepo: IEntityMapRepository, defcon: DefconClient) {
    this.entityMapRepo = entityMapRepo;
    this.defcon = defcon;
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
    // Insert a sentinel with a placeholder entityId before the async call.
    // Only the caller that wins the INSERT proceeds to createEntity;
    // concurrent callers see the conflict and bail out, preventing duplicate entities.
    const sentinel = "__pending__";
    const won = this.entityMapRepo.insertIfAbsent(event.sourceId, event.externalId, sentinel);
    if (!won) {
      return;
    }

    let response: { entityId: string };
    try {
      response = await this.defcon.createEntity({
        flowName: event.flowName,
      });
    } catch (err) {
      // Clean up the sentinel so future events can retry.
      this.entityMapRepo.deleteRow(event.sourceId, event.externalId);
      throw err;
    }

    // Update the sentinel row to the real entityId.
    this.entityMapRepo.updateEntityId(event.sourceId, event.externalId, response.entityId);
  }

  private async handleUpdate(event: IngestEvent): Promise<void> {
    const entityId = this.entityMapRepo.findEntityId(event.sourceId, event.externalId);
    if (entityId === undefined || entityId === "__pending__") {
      return;
    }

    await this.defcon.report({
      entityId,
      signal: event.signal ?? "update",
      artifacts: event.payload ?? {},
    });
  }
}
