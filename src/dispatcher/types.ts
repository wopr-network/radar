export interface WorkerResult {
  signal: string;
  artifacts: Record<string, unknown>;
}

export interface Dispatcher {
  dispatch(prompt: string): Promise<WorkerResult>;
}
