export interface WorkerResult {
  signal: string;
  artifacts: Record<string, unknown>;
  exitCode: number;
}

export interface DispatchOpts {
  modelTier: "opus" | "sonnet" | "haiku";
  workerId: string;
  entityId: string;
  timeout?: number;
}

export interface Dispatcher {
  dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult>;
}
