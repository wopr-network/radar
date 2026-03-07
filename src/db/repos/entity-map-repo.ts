import { and, eq } from "drizzle-orm";
import type { NoradDb } from "../index.js";
import { entityMap } from "../schema.js";

export interface IEntityMapRepository {
  findEntityId(sourceId: string, externalId: string): string | undefined;
  insertIfAbsent(sourceId: string, externalId: string, entityId: string): void;
}

export class DrizzleEntityMapRepository implements IEntityMapRepository {
  constructor(private db: NoradDb) {}

  findEntityId(sourceId: string, externalId: string): string | undefined {
    const row = this.db
      .select()
      .from(entityMap)
      .where(and(eq(entityMap.sourceId, sourceId), eq(entityMap.externalId, externalId)))
      .get();
    return row?.entityId;
  }

  insertIfAbsent(sourceId: string, externalId: string, entityId: string): void {
    const id = `${sourceId}:${externalId}`;
    const now = Math.floor(Date.now() / 1000);
    this.db
      .insert(entityMap)
      .values({ id, sourceId, externalId, entityId, createdAt: now })
      .onConflictDoNothing()
      .run();
  }
}
