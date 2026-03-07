import { Command } from "commander";
import { describe, expect, it } from "vitest";

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride(); // throw instead of process.exit

  program
    .command("run")
    .description("Start the worker pool")
    .requiredOption("-w, --workers <n>", "Number of worker slots", (v: string) => Number.parseInt(v, 10))
    .requiredOption("-r, --role <role>", "Worker discipline")
    .option("-f, --flow <flow>", "Restrict to a specific flow")
    .option("--worker <type>", "Worker type identifier")
    .option("--seed <path>", "Seed file path")
    .option("--defcon-url <url>", "DEFCON server URL", "http://localhost:3000")
    .action(() => {});

  return program;
}

describe("norad run CLI parsing", () => {
  it("parses all options", () => {
    const program = buildProgram();
    program.parse([
      "node",
      "norad",
      "run",
      "--workers",
      "8",
      "--role",
      "engineering",
      "--worker",
      "claude-code",
      "--flow",
      "wopr-changeset",
      "--seed",
      "seeds/norad.json",
      "--defcon-url",
      "http://defcon:3000",
    ]);
    const opts = program.commands[0].opts();
    expect(opts.workers).toBe(8);
    expect(opts.role).toBe("engineering");
    expect(opts.worker).toBe("claude-code");
    expect(opts.flow).toBe("wopr-changeset");
    expect(opts.seed).toBe("seeds/norad.json");
    expect(opts.defconUrl).toBe("http://defcon:3000");
  });

  it("uses default defcon-url when not specified", () => {
    const program = buildProgram();
    program.parse(["node", "norad", "run", "-w", "4", "-r", "devops"]);
    const opts = program.commands[0].opts();
    expect(opts.defconUrl).toBe("http://localhost:3000");
  });

  it("errors when --workers is missing", () => {
    const program = buildProgram();
    expect(() => {
      program.parse(["node", "norad", "run", "-r", "qa"]);
    }).toThrow();
  });

  it("errors when --role is missing", () => {
    const program = buildProgram();
    expect(() => {
      program.parse(["node", "norad", "run", "-w", "4"]);
    }).toThrow();
  });
});

describe("role validation", () => {
  it("accepts valid disciplines", () => {
    for (const role of ["engineering", "devops", "qa", "security"]) {
      const program = buildProgram();
      program.parse(["node", "norad", "run", "-w", "1", "-r", role]);
      expect(program.commands[0].opts().role).toBe(role);
    }
  });
});
