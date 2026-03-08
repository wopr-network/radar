export type ClaimResponse =
  | {
      next_action: "check_back";
      retry_after_ms: number;
      message: string;
    }
  | {
      entity_id: string;
      invocation_id: string;
      flow: string;
      stage: string;
      prompt: string;
      context: Record<string, unknown> | null;
      worker_notice?: string;
    };

export type ReportResponse =
  | { next_action: "continue"; new_state: string; prompt: string }
  | { next_action: "waiting"; gated: true; gateName: string; gate_output: string; message?: string }
  | { next_action: "check_back"; message: string; retry_after_ms: number };

export interface CreateEntityResponse {
  entityId: string;
}
