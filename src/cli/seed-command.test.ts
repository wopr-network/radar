import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../seed/loader.js", () => ({
  loadSeed: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  createDb: vi.fn(),
}));

describe("radar seed command (runSeed)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should call loadSeed with correct path and deps", async () => {
    const { loadSeed } = await import("../seed/loader.js");
    const { createDb } = await import("../db/index.js");

    const mockClient = { close: vi.fn() };
    const mockDb = { $client: mockClient };
    vi.mocked(createDb).mockReturnValue(mockDb as never);
    vi.mocked(loadSeed).mockResolvedValue({ flows: 2, sources: 1, watches: 1 });

    const { runSeed } = await import("./seed-action.js");

    await runSeed({ seedPath: "seeds/test.seed.json", defconUrl: "http://localhost:3000", db: "test.db" });

    expect(createDb).toHaveBeenCalledWith("test.db");
    expect(loadSeed).toHaveBeenCalledWith("seeds/test.seed.json", {
      defconUrl: "http://localhost:3000",
      db: mockDb,
    });
    expect(mockClient.close).toHaveBeenCalled();
  });

  it("should log summary on success", async () => {
    const { loadSeed } = await import("../seed/loader.js");
    const { createDb } = await import("../db/index.js");
    const { logger } = await import("../logger.js");

    const mockClient = { close: vi.fn() };
    const mockDb = { $client: mockClient };
    vi.mocked(createDb).mockReturnValue(mockDb as never);
    vi.mocked(loadSeed).mockResolvedValue({ flows: 3, sources: 2, watches: 4 });

    const loggerSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);

    const { runSeed } = await import("./seed-action.js");
    await runSeed({ seedPath: "seeds/test.seed.json", defconUrl: "http://localhost:3000", db: "radar.db" });

    expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining("3 flows"));
    loggerSpy.mockRestore();
  });

  it("should close db even on error", async () => {
    const { loadSeed } = await import("../seed/loader.js");
    const { createDb } = await import("../db/index.js");

    const mockClient = { close: vi.fn() };
    const mockDb = { $client: mockClient };
    vi.mocked(createDb).mockReturnValue(mockDb as never);
    vi.mocked(loadSeed).mockRejectedValue(new Error("bad seed"));

    const { runSeed } = await import("./seed-action.js");

    await expect(runSeed({ seedPath: "bad.json", defconUrl: "http://localhost:3000", db: "radar.db" })).rejects.toThrow(
      "bad seed",
    );
    expect(mockClient.close).toHaveBeenCalled();
  });
});
