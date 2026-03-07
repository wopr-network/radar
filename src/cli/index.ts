#!/usr/bin/env node
import { Command } from "commander";

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

program.parse();
