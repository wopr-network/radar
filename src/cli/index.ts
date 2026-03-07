#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { renderWorkerPrompt } from "./worker-prompt.js";

const program = new Command();

program.name("norad").description("The only winning move is to have gates.").version("0.1.0");

program
  .command("run")
  .description("Start the worker pool")
  .requiredOption("-w, --workers <n>", "Number of worker slots", parseInt)
  .requiredOption("-r, --role <role>", "Worker discipline (engineering, devops, qa, security)")
  .option("-f, --flow <flow>", "Restrict to a specific flow")
  .option("--defcon-url <url>", "DEFCON server URL", "http://localhost:3000")
  .action(async (opts) => {
    console.log(`[norad] ${opts.workers} worker slots — role: ${opts.role}`);
    console.log("[norad] not yet implemented");
    process.exit(0);
  });

const VALID_DISCIPLINES = ["engineering", "devops", "qa", "security"] as const;

const worker = program.command("worker").description("Worker management");

worker
  .command("new")
  .description("Register a new worker and print its bootstrap prompt")
  .requiredOption("-d, --discipline <discipline>", "Worker discipline (engineering, devops, qa, security)")
  .option("--defcon-url <url>", "DEFCON server URL", "http://localhost:3000")
  .option("--worker-id <id>", "Use a specific worker ID instead of generating one")
  .action((opts) => {
    if (!(VALID_DISCIPLINES as readonly string[]).includes(opts.discipline)) {
      console.error(`Error: invalid discipline "${opts.discipline}". Must be one of: ${VALID_DISCIPLINES.join(", ")}`);
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

program.parse();
