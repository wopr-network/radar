import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../seed/loader.js", () => ({
  loadSeed: vi.fn(),
}));

vi.mock("better-sqlite3", () => ({
  default: vi.fn(),
}));

describe("norad seed command (runSeed)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should call loadSeed with correct path and deps", async () => {
    const { loadSeed } = await import("../seed/loader.js");
    const BetterSqlite3 = (await import("better-sqlite3")).default;

    const mockDbInstance = { close: vi.fn(), pragma: vi.fn() };
    vi.mocked(BetterSqlite3).mockReturnValue(mockDbInstance as never);
    vi.mocked(loadSeed).mockResolvedValue({ flows: 2, sources: 1, watches: 1 });

    const { runSeed } = await import("./seed-action.js");

    await runSeed({ seedPath: "seeds/test.seed.json", defconUrl: "http://localhost:3000", db: "test.db" });

    expect(BetterSqlite3).toHaveBeenCalledWith("test.db");
    expect(loadSeed).toHaveBeenCalledWith("seeds/test.seed.json", {
      defconUrl: "http://localhost:3000",
      db: mockDbInstance,
    });
    expect(mockDbInstance.close).toHaveBeenCalled();
  });

  it("should print summary on success", async () => {
    const { loadSeed } = await import("../seed/loader.js");
    const BetterSqlite3 = (await import("better-sqlite3")).default;

    const mockDbInstance = { close: vi.fn(), pragma: vi.fn() };
    vi.mocked(BetterSqlite3).mockReturnValue(mockDbInstance as never);
    vi.mocked(loadSeed).mockResolvedValue({ flows: 3, sources: 2, watches: 4 });

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { runSeed } = await import("./seed-action.js");
    await runSeed({ seedPath: "seeds/test.seed.json", defconUrl: "http://localhost:3000", db: "norad.db" });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("3 flows"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("2 sources"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("4 watches"));
    consoleSpy.mockRestore();
  });

  it("should close db even on error", async () => {
    const { loadSeed } = await import("../seed/loader.js");
    const BetterSqlite3 = (await import("better-sqlite3")).default;

    const mockDbInstance = { close: vi.fn(), pragma: vi.fn() };
    vi.mocked(BetterSqlite3).mockReturnValue(mockDbInstance as never);
    vi.mocked(loadSeed).mockRejectedValue(new Error("bad seed"));

    const { runSeed } = await import("./seed-action.js");

    await expect(runSeed({ seedPath: "bad.json", defconUrl: "http://localhost:3000", db: "norad.db" })).rejects.toThrow(
      "bad seed",
    );
    expect(mockDbInstance.close).toHaveBeenCalled();
  });
});
