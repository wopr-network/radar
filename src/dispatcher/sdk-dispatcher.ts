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

async function safeInsert(
  repo: IEntityActivityRepo,
  input: Parameters<IEntityActivityRepo["insert"]>[0],
  tag: string,
): Promise<void> {
  try {
    await repo.insert(input);
  } catch (dbErr) {
    console.error(`[claude] [${tag}] activity insert error`, dbErr instanceof Error ? dbErr.message : String(dbErr));
  }
}

export class SdkDispatcher implements Dispatcher {
  constructor(private activityRepo: IEntityActivityRepo) {}

  async dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult> {
    const { entityId, workerId: slotId, modelTier, timeout = DEFAULT_TIMEOUT_MS } = opts;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const allTextBlocks: string[] = [];

    try {
      console.log(`[claude] [${slotId}] START entity=${entityId} model=${MODEL_MAP[modelTier]}`);
      await safeInsert(this.activityRepo, { entityId, slotId, type: "start", data: {} }, slotId);

      // Strip CLAUDECODE env var so the claude subprocess doesn't refuse to start
      // when radar itself is running inside a Claude Code session.
      // Filter out undefined values so the type is Record<string, string>.
      const env = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      );
      delete env.CLAUDECODE;

      const linearApiKey = env.LINEAR_API_KEY;
      // Linear's official MCP is a remote server; mcp-remote bridges it as stdio.
      // The Authorization header must be passed as a CLI arg — mcp-remote has no env-var
      // alternative for custom headers. The key is visible in /proc/<pid>/cmdline on Linux.
      const mcpServers = linearApiKey
        ? {
            "linear-server": {
              type: "stdio" as const,
              command: "npx",
              args: [
                "-y",
                "mcp-remote",
                "https://mcp.linear.app/mcp",
                "--header",
                `Authorization: Bearer ${linearApiKey}`,
              ],
              env,
            },
          }
        : undefined;

      for await (const message of query({
        prompt,
        options: {
          abortController: controller,
          model: MODEL_MAP[modelTier],
          permissionMode: "bypassPermissions",
          ...(mcpServers ? { mcpServers } : {}),
          env,
          stderr: (line: string) => process.stderr.write(`[sdk] ${line}`),
        },
      })) {
        if (message.type === "system") {
          console.log(`[claude] [${slotId}] system subtype=${message.subtype}`);
        } else if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use") {
              console.log(`[claude] [${slotId}] tool_use ${block.name} ${JSON.stringify(block.input).slice(0, 120)}`);
              await safeInsert(
                this.activityRepo,
                { entityId, slotId, type: "tool_use", data: { name: block.name, input: block.input } },
                slotId,
              );
            } else if (block.type === "text" && block.text) {
              allTextBlocks.push(block.text);
              console.log(`[claude] [${slotId}] text "${block.text.slice(0, 200).replace(/\n/g, " ")}"`);
              await safeInsert(
                this.activityRepo,
                { entityId, slotId, type: "text", data: { text: block.text } },
                slotId,
              );
            }
          }
        } else if (message.type === "result") {
          const costUsd = message.total_cost_usd;
          const subtype = message.subtype;
          console.log(
            `[claude] [${slotId}] RESULT subtype=${subtype} is_error=${message.is_error} stop_reason=${message.stop_reason} cost=$${costUsd?.toFixed(4) ?? "?"}`,
          );
          await safeInsert(
            this.activityRepo,
            {
              entityId,
              slotId,
              type: "result",
              data: { subtype, cost_usd: costUsd, stop_reason: message.stop_reason },
            },
            slotId,
          );

          if (message.is_error) {
            return { signal: "crash", artifacts: {}, exitCode: 1 };
          }

          const { signal, artifacts } = parseSignal(allTextBlocks.join("\n"));
          console.log(`[claude] [${slotId}] parsed signal=${signal}`);
          return {
            signal,
            artifacts,
            exitCode: 0,
          };
        } else {
          console.log(`[claude] [${slotId}] msg type=${(message as { type: string }).type}`);
        }
      }

      console.log(`[claude] [${slotId}] stream ended without result`);
      // Stream ended without a result message
      return { signal: "crash", artifacts: {}, exitCode: -1 };
    } catch (err) {
      if (controller.signal.aborted) {
        console.log(`[claude] [${slotId}] TIMEOUT`);
        return { signal: "timeout", artifacts: {}, exitCode: -1 };
      }
      console.error(`[claude] [${slotId}] ERROR`, err instanceof Error ? err.message : String(err));
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
