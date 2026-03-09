import type { WorkerRepo } from "../api/types.js";
import type { IEntityActivityRepo } from "../db/repos/i-entity-activity-repo.js";
import type { DefconClient } from "../defcon/client.js";
import type { Dispatcher } from "../dispatcher/types.js";
import type { Pool } from "../pool/pool.js";

export interface RunLoopConfig {
  pool: Pool;
  defcon: DefconClient;
  dispatcher: Dispatcher;
  activityRepo?: IEntityActivityRepo;
  workerRepo?: WorkerRepo;
  workerType?: string;
  workerDiscipline?: string;
  role: string;
  flow?: string;
  pollIntervalMs?: number;
  workerIdPrefix?: string;
  maxConcurrent?: number;
  maxConcurrentPerRepo?: number;
  stopTimeoutMs?: number;
}
