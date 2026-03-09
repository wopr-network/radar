import type { IWorkerRepo } from "../api/types.js";
import type { IEntityActivityRepo } from "../db/repos/i-entity-activity-repo.js";
import type { DefconClient } from "../defcon/client.js";
import type { Dispatcher } from "../dispatcher/types.js";
import type { Pool } from "../pool/pool.js";

export interface SlotRole {
  discipline: string;
  count: number;
}

export interface RunLoopConfig {
  pool: Pool;
  defcon: DefconClient;
  dispatcher: Dispatcher;
  activityRepo?: IEntityActivityRepo;
  workerRepo?: IWorkerRepo;
  workerType?: string;
  workerDiscipline?: string;
  roles: SlotRole[];
  flow?: string;
  pollIntervalMs?: number;
  workerIdPrefix?: string;
  maxConcurrent?: number;
  maxConcurrentPerRepo?: number;
  stopTimeoutMs?: number;
}
