import { query } from "@anthropic-ai/claude-agent-sdk";
import type { IEntityActivityRepo } from "../db/repos/entity-activity-repo.js";
import { parseSignal } from "./parse-signal.js";
import type { Dispatcher, DispatchOpts, WorkerResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const MODEL_MAP: Record<DispatchOpts["modelTier"], string> = {
  opus: "claude-opus-4-6",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5",
};

export class SdkDispatcher implements Dispatcher {
  constructor(private activityRepo: IEntityActivityRepo) {}

  async dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult> {
    const { entityId, workerId: slotId, modelTier, timeout = DEFAULT_TIMEOUT_MS } = opts;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let lastText = "";

    try {
      this.activityRepo.insert({ entityId, slotId, type: "start", data: {} });
      for await (const message of query({
        prompt,
        options: {
          abortController: controller,
          model: MODEL_MAP[modelTier],
          allowedTools: ["Edit", "Read", "Write", "Bash", "Glob", "Grep"],
        },
      })) {
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use") {
              this.activityRepo.insert({
                entityId,
                slotId,
                type: "tool_use",
                data: { name: block.name, input: block.input },
              });
            } else if (block.type === "text" && block.text) {
              lastText = block.text;
              this.activityRepo.insert({
                entityId,
                slotId,
                type: "text",
                data: { text: block.text },
              });
            }
          }
        } else if (message.type === "result") {
          const costUsd = message.total_cost_usd;
          const subtype = message.subtype;
          this.activityRepo.insert({
            entityId,
            slotId,
            type: "result",
            data: { subtype, cost_usd: costUsd, stop_reason: message.stop_reason },
          });

          if (message.is_error) {
            return { signal: "crash", artifacts: {}, exitCode: 1 };
          }

          const { signal, artifacts } = parseSignal(lastText);
          return {
            signal,
            artifacts,
            exitCode: 0,
          };
        }
      }

      // Stream ended without a result message
      return { signal: "crash", artifacts: {}, exitCode: -1 };
    } catch (err) {
      if (controller.signal.aborted) {
        return { signal: "timeout", artifacts: {}, exitCode: -1 };
      }
      return {
        signal: "crash",
        artifacts: { error: err instanceof Error ? err.message : String(err) },
        exitCode: -1,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
