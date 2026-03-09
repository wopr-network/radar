import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import Handlebars from "handlebars";
import type { IEntityActivityRepo } from "../db/repos/entity-activity-repo.js";
import { logger } from "../logger.js";
import { parseSignal } from "./parse-signal.js";
import type { Dispatcher, DispatchOpts, WorkerResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_AGENTS_DIR = join(homedir(), ".claude", "agents");

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
    logger.error(`[claude] [${tag}] activity insert error`, {
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
  }
}

function loadAgentMd(agentsDir: string, agentRole: string): string | null {
  // Reject roles containing path separators or dots to prevent path traversal.
  if (!/^[\w-]+$/.test(agentRole)) {
    logger.warn(`[claude] agentRole "${agentRole}" contains invalid characters — skipping MD load`);
    return null;
  }
  const resolvedDir = resolve(agentsDir);
  const resolvedFile = resolve(join(resolvedDir, `${agentRole}.md`));
  if (!resolvedFile.startsWith(`${resolvedDir}/`) && resolvedFile !== resolvedDir) {
    logger.warn(`[claude] agentRole path "${resolvedFile}" escapes agentsDir — skipping MD load`);
    return null;
  }
  try {
    return readFileSync(resolvedFile, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn(`[claude] failed to load agent MD "${resolvedFile}"`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

export class SdkDispatcher implements Dispatcher {
  private agentsDir: string;

  constructor(
    private activityRepo: IEntityActivityRepo,
    agentsDir?: string,
  ) {
    this.agentsDir = agentsDir ?? DEFAULT_AGENTS_DIR;
  }

  async dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult> {
    const { entityId, workerId: slotId, modelTier, agentRole, timeout = DEFAULT_TIMEOUT_MS, templateContext } = opts;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const allTextBlocks: string[] = [];

    try {
      const rawAgentMd = agentRole ? loadAgentMd(this.agentsDir, agentRole) : null;
      let agentMd = rawAgentMd;
      if (rawAgentMd && templateContext) {
        try {
          agentMd = Handlebars.compile(rawAgentMd)(templateContext);
        } catch (err) {
          logger.warn(`[claude] failed to render agent MD template for "${agentRole}"`, {
            error: err instanceof Error ? err.message : String(err),
          });
          agentMd = rawAgentMd;
        }
      }
      const fullPrompt = agentMd ? `${agentMd}\n\n---\n\n${prompt}` : prompt;

      logger.info(`[claude] [${slotId}] START`, {
        entity: entityId,
        model: MODEL_MAP[modelTier],
        ...(agentRole ? { agentRole } : {}),
      });
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
        prompt: fullPrompt,
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
          logger.info(`[claude] [${slotId}] system`, { subtype: message.subtype });
        } else if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "tool_use") {
              logger.info(`[claude] [${slotId}] tool_use`, {
                tool: block.name,
                input: JSON.stringify(block.input).slice(0, 120),
              });
              await safeInsert(
                this.activityRepo,
                { entityId, slotId, type: "tool_use", data: { name: block.name, input: block.input } },
                slotId,
              );
            } else if (block.type === "text" && block.text) {
              allTextBlocks.push(block.text);
              logger.info(`[claude] [${slotId}] text`, {
                preview: block.text.slice(0, 200).replace(/\n/g, " "),
              });
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
          logger.info(`[claude] [${slotId}] RESULT`, {
            subtype,
            is_error: message.is_error,
            stop_reason: message.stop_reason,
            cost_usd: costUsd?.toFixed(4) ?? "?",
          });
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
          logger.info(`[claude] [${slotId}] parsed signal`, { signal });
          return {
            signal,
            artifacts,
            exitCode: 0,
          };
        } else {
          logger.info(`[claude] [${slotId}] msg`, { type: (message as { type: string }).type });
        }
      }

      logger.warn(`[claude] [${slotId}] stream ended without result`);
      // Stream ended without a result message
      return { signal: "crash", artifacts: {}, exitCode: -1 };
    } catch (err) {
      if (controller.signal.aborted) {
        logger.warn(`[claude] [${slotId}] TIMEOUT`);
        return { signal: "timeout", artifacts: {}, exitCode: -1 };
      }
      logger.error(`[claude] [${slotId}] ERROR`, { error: err instanceof Error ? err.message : String(err) });
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
