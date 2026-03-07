import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BRANCH_NAME_REGEX, validateBranchName, validateWorktreePath } from "../src/sources/validation.js";

const TEST_BASE = resolve("/tmp/test-worktrees");

describe("validateWorktreePath", () => {
  it("accepts a path within the base directory", () => {
    const result = validateWorktreePath("/tmp/test-worktrees/my-branch", TEST_BASE);
    expect(result).toBe(resolve("/tmp/test-worktrees/my-branch"));
  });

  it("accepts the base directory itself", () => {
    const result = validateWorktreePath("/tmp/test-worktrees", TEST_BASE);
    expect(result).toBe(TEST_BASE);
  });

  it("accepts nested subdirectories", () => {
    const result = validateWorktreePath("/tmp/test-worktrees/org/repo/branch", TEST_BASE);
    expect(result).toBe(resolve("/tmp/test-worktrees/org/repo/branch"));
  });

  it("throws on path traversal with ../", () => {
    expect(() => validateWorktreePath("/tmp/test-worktrees/../etc/passwd", TEST_BASE)).toThrow(
      "Worktree path must be within",
    );
  });

  it("throws on absolute path outside base", () => {
    expect(() => validateWorktreePath("/etc/passwd", TEST_BASE)).toThrow("Worktree path must be within");
  });

  it("throws on sibling directory with similar prefix", () => {
    expect(() => validateWorktreePath("/tmp/test-worktrees-evil/payload", TEST_BASE)).toThrow(
      "Worktree path must be within",
    );
  });

  it("resolves relative paths against cwd and validates", () => {
    expect(() => validateWorktreePath("../../etc/passwd", TEST_BASE)).toThrow("Worktree path must be within");
  });
});

describe("validateBranchName", () => {
  it("accepts simple branch names", () => {
    expect(validateBranchName("main")).toBe("main");
  });

  it("accepts branch names with slashes", () => {
    expect(validateBranchName("feature/WOP-1844")).toBe("feature/WOP-1844");
  });

  it("accepts branch names with hyphens and underscores", () => {
    expect(validateBranchName("fix_bug-123")).toBe("fix_bug-123");
  });

  it("throws on branch names with dots", () => {
    expect(() => validateBranchName("feature/v1.0")).toThrow("Invalid branch name");
  });

  it("throws on branch names with spaces", () => {
    expect(() => validateBranchName("my branch")).toThrow("Invalid branch name");
  });

  it("throws on empty string", () => {
    expect(() => validateBranchName("")).toThrow("Invalid branch name");
  });

  it("throws on path traversal in branch name", () => {
    expect(() => validateBranchName("../../../etc/passwd")).toThrow("Invalid branch name");
  });

  it("throws on branch names with special characters", () => {
    expect(() => validateBranchName("branch;rm -rf /")).toThrow("Invalid branch name");
  });
});

describe("BRANCH_NAME_REGEX", () => {
  it("is exported and is a RegExp", () => {
    expect(BRANCH_NAME_REGEX).toBeInstanceOf(RegExp);
  });
});
