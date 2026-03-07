#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { renderWorkerPrompt } from "./worker-prompt.js";

export const VALID_DISCIPLINES = ["engineering", "devops", "qa", "security"] as const;

export function buildProgram(): Command {
  const program = new Command();
  program.name("norad").description("The only winning move is to have gates.").version("0.1.0");

  program
    .command("run")
    .description("Start the worker pool")
    .requiredOption("-w, --workers <n>", "Number of worker slots", (v: string) => Number.parseInt(v, 10))
    .requiredOption("-r, --role <role>", "Worker discipline (engineering, devops, qa, security)")
    .option("-f, --flow <flow>", "Restrict to a specific flow")
    .option("--max-concurrent <n>", "Max concurrent entities for the flow", (v: string) => Number.parseInt(v, 10))
    .option("--max-concurrent-per-repo <n>", "Max concurrent entities per repo", (v: string) => Number.parseInt(v, 10))
    .option("--worker <type>", "Worker type identifier")
    .option("--seed <path>", "Seed file path")
    .option("--defcon-url <url>", "DEFCON server URL", "http://localhost:3000")
    .action(async (opts) => {
      if (Number.isNaN(opts.workers) || opts.workers <= 0) {
        console.error(`Error: --workers must be a positive integer, got "${opts.workers}"`);
        process.exit(1);
      }

      if (!(VALID_DISCIPLINES as readonly string[]).includes(opts.role)) {
        console.error(`Error: invalid role "${opts.role}". Must be one of: ${VALID_DISCIPLINES.join(", ")}`);
        process.exit(1);
      }

      if (opts.maxConcurrent != null && (Number.isNaN(opts.maxConcurrent) || opts.maxConcurrent < 1)) {
        console.error(`Invalid --max-concurrent: ${opts.maxConcurrent}`);
        process.exit(1);
      }

      if (
        opts.maxConcurrentPerRepo != null &&
        (Number.isNaN(opts.maxConcurrentPerRepo) || opts.maxConcurrentPerRepo < 1)
      ) {
        console.error(`Invalid --max-concurrent-per-repo: ${opts.maxConcurrentPerRepo}`);
        process.exit(1);
      }

      if (opts.seed) {
        const { default: Database } = await import("better-sqlite3");
        const { loadSeed } = await import("../seed/loader.js");
        const db = new Database(":memory:");
        try {
          const result = await loadSeed(opts.seed as string, { defconUrl: opts.defconUrl as string, db });
          console.log(
            `[norad] Seed loaded: ${result.flows} flows, ${result.sources} sources, ${result.watches} watches`,
          );
        } catch (err) {
          console.error(`[norad] Seed failed: ${(err as Error).message}`);
          process.exit(1);
        }
        // db intentionally kept open for the process lifetime — sources/watches
        // are stored here and read by the API server (sourceRepo/watchRepo).
        process.once("exit", () => db.close());
      }

      const { Pool } = await import("../pool/pool.js");
      const { DefconClient } = await import("../defcon/client.js");
      const { ClaudeCodeDispatcher } = await import("../dispatcher/claude-code-dispatcher.js");
      const { RunLoop } = await import("../run-loop/run-loop.js");

      const pool = new Pool(opts.workers);
      const defcon = new DefconClient({ url: opts.defconUrl });
      const dispatcher = new ClaudeCodeDispatcher();

      const loop = new RunLoop({
        pool,
        defcon,
        dispatcher,
        role: opts.role,
        flow: opts.flow,
        workerIdPrefix: opts.worker,
        pollIntervalMs: 5000,
        maxConcurrent: opts.maxConcurrent,
        maxConcurrentPerRepo: opts.maxConcurrentPerRepo,
      });

      console.log(
        `[norad] Starting ${opts.workers} worker slots — role: ${opts.role}${opts.flow ? ` — flow: ${opts.flow}` : ""}${opts.worker ? ` — worker: ${opts.worker}` : ""}`,
      );
      loop.start();

      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log("[norad] Shutting down gracefully...");
        await loop.stop();
        console.log("[norad] All slots stopped.");
        process.exit(0);
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });

  const worker = program.command("worker").description("Worker management");

  worker
    .command("new")
    .description("Register a new worker and print its bootstrap prompt")
    .requiredOption("-d, --discipline <discipline>", "Worker discipline (engineering, devops, qa, security)")
    .option("--defcon-url <url>", "DEFCON server URL", "http://localhost:3000")
    .option("--worker-id <id>", "Use a specific worker ID instead of generating one")
    .action((opts) => {
      if (!(VALID_DISCIPLINES as readonly string[]).includes(opts.discipline)) {
        console.error(
          `Error: invalid discipline "${opts.discipline}". Must be one of: ${VALID_DISCIPLINES.join(", ")}`,
        );
        process.exit(1);
      }
      const workerId = opts.workerId ?? `wkr-${randomUUID()}`;
      const prompt = renderWorkerPrompt({
        workerId,
        discipline: opts.discipline,
        defconUrl: opts.defconUrl,
      });
      console.log(prompt);
    });

  program
    .command("seed")
    .description(
      "Push seed file to DEFCON and local DB.\n" +
        "  Expected JSON shape: { flows: Flow[], sources: Source[], watches: Watch[] }\n" +
        "  where each Flow has { name, initialState, states, transitions, ... },\n" +
        "  each Source has { id, type, token?, config? },\n" +
        "  and each Watch has { id, sourceId, event, flowName, filter? }.",
    )
    .argument("<path>", "Path to the seed JSON file")
    .option("--defcon-url <url>", "DEFCON server URL", "http://localhost:3000")
    .requiredOption(
      "--db <path>",
      "Local SQLite database path (required — use a dedicated seed DB, not the live norad.db)",
    )
    .action(async (seedPath: string, opts: { defconUrl: string; db: string }) => {
      const { runSeed } = await import("./seed-action.js");
      try {
        await runSeed({ seedPath, defconUrl: opts.defconUrl, db: opts.db });
      } catch (err) {
        console.error(`[norad] Seed failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
    });

  return program;
}

// Only auto-parse when run as the entry point, not when imported in tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildProgram().parseAsync();
}
