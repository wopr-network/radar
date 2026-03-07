export type SlotState = "idle" | "claimed" | "working" | "reporting";

export interface WorkerResult {
  signal: string;
  artifacts: Record<string, unknown>;
}

export interface Slot {
  slotId: string;
  workerId: string;
  entityId: string | null;
  state: SlotState;
  prompt: string | null;
  result: WorkerResult | null;
}
