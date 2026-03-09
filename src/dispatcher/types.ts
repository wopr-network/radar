import type { WorkerResult } from "../pool/types.js";

export type { WorkerResult };

export interface DispatchOpts {
  modelTier: "opus" | "sonnet" | "haiku";
  workerId: string;
  entityId: string;
  agentRole?: string | null;
  timeout?: number;
  /** Handlebars context from defcon's invocation-builder — used to render agent MD templates */
  templateContext?: Record<string, unknown> | null;
}

export interface Dispatcher {
  dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult>;
}
