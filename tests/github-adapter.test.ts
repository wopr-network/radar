import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GitHubSourceAdapter } from "../src/sources/github-adapter.js";

const TEST_BASE = resolve("/tmp/test-worktrees");

describe("GitHubSourceAdapter", () => {
  it("constructs with explicit worktree base", () => {
    const adapter = new GitHubSourceAdapter({ worktreeBase: TEST_BASE });
    expect(adapter).toBeDefined();
  });

  it("constructs with default worktree base", () => {
    const adapter = new GitHubSourceAdapter();
    expect(adapter).toBeDefined();
  });

  describe("resolveWorktreePath", () => {
    it("resolves a valid subpath", () => {
      const adapter = new GitHubSourceAdapter({ worktreeBase: TEST_BASE });
      const result = adapter.resolveWorktreePath("my-branch");
      expect(result).toBe(resolve(TEST_BASE, "my-branch"));
    });

    it("throws on path traversal", () => {
      const adapter = new GitHubSourceAdapter({ worktreeBase: TEST_BASE });
      expect(() => adapter.resolveWorktreePath("../../etc/passwd")).toThrow("Worktree path must be within");
    });
  });

  describe("validateBranch", () => {
    it("accepts valid branch names", () => {
      const adapter = new GitHubSourceAdapter({ worktreeBase: TEST_BASE });
      expect(adapter.validateBranch("feature/WOP-1844")).toBe("feature/WOP-1844");
    });

    it("rejects invalid branch names", () => {
      const adapter = new GitHubSourceAdapter({ worktreeBase: TEST_BASE });
      expect(() => adapter.validateBranch("../../../etc")).toThrow("Invalid branch name");
    });
  });
});
