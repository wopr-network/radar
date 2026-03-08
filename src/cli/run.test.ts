import { describe, expect, it, vi } from "vitest";
import { buildProgram } from "./index.js";

function makeProgram() {
  const program = buildProgram();
  program.exitOverride(); // throw instead of process.exit in tests
  // Prevent the async action from running (we only test parsing here)
  const runCmd = program.commands.find((c) => c.name() === "run");
  if (runCmd) runCmd.action(() => {});
  return program;
}

describe("norad run CLI parsing", () => {
  it("parses all options", () => {
    const program = makeProgram();
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
    const program = makeProgram();
    program.parse(["node", "norad", "run", "-w", "4", "-r", "devops"]);
    const opts = program.commands[0].opts();
    expect(opts.defconUrl).toBe("http://localhost:3000");
  });

  it("errors when --workers is missing", () => {
    const program = makeProgram();
    expect(() => {
      program.parse(["node", "norad", "run", "-r", "qa"]);
    }).toThrow();
  });

  it("errors when --role is missing", () => {
    const program = makeProgram();
    expect(() => {
      program.parse(["node", "norad", "run", "-w", "4"]);
    }).toThrow();
  });

  it("rejects NaN --workers value", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = buildProgram(); // use real action so validation runs
    program.exitOverride();
    try {
      await expect(program.parseAsync(["node", "norad", "run", "-w", "foo", "-r", "engineering"])).rejects.toThrow(
        "process.exit called",
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--workers must be a positive integer"));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("port validation", () => {
  it("accepts valid port number", () => {
    const program = makeProgram();
    program.parse(["node", "norad", "run", "-w", "1", "-r", "engineering", "--port", "9090"]);
    const opts = program.commands[0].opts();
    expect(opts.port).toBe(9090);
  });

  it("uses default port 8080 when not specified", () => {
    const program = makeProgram();
    program.parse(["node", "norad", "run", "-w", "1", "-r", "engineering"]);
    const opts = program.commands[0].opts();
    expect(opts.port).toBe(8080);
  });

  it("exits with error for non-numeric port", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = buildProgram();
    program.exitOverride();
    try {
      await expect(
        program.parseAsync(["node", "norad", "run", "-w", "1", "-r", "engineering", "--port", "foo"]),
      ).rejects.toThrow("process.exit called");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid port"));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("exits with error for port 0", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = buildProgram();
    program.exitOverride();
    try {
      await expect(
        program.parseAsync(["node", "norad", "run", "-w", "1", "-r", "engineering", "--port", "0"]),
      ).rejects.toThrow("process.exit called");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid port"));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it("rejects port > 65535 (Commander range check)", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = buildProgram();
    program.exitOverride();
    try {
      await expect(
        program.parseAsync(["node", "norad", "run", "-w", "1", "-r", "engineering", "--port", "99999"]),
      ).rejects.toThrow();
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe("role validation", () => {
  it("accepts valid disciplines", () => {
    for (const role of ["engineering", "devops", "qa", "security"]) {
      const program = makeProgram();
      program.parse(["node", "norad", "run", "-w", "1", "-r", role]);
      expect(program.commands[0].opts().role).toBe(role);
    }
  });

  it("exits with error for invalid role", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as () => never);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const program = buildProgram(); // use real action so validation runs
    program.exitOverride();
    try {
      await expect(program.parseAsync(["node", "norad", "run", "-w", "1", "-r", "hacker"])).rejects.toThrow(
        "process.exit called",
      );
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("invalid role"));
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
