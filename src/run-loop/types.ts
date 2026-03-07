import type { DefconClient } from "../defcon/client.js";
import type { Dispatcher } from "../dispatcher/types.js";
import type { Pool } from "../pool/pool.js";

export interface RunLoopConfig {
  pool: Pool;
  defcon: DefconClient;
  dispatcher: Dispatcher;
  role: string;
  flow?: string;
  pollIntervalMs?: number;
  workerIdPrefix?: string;
}
