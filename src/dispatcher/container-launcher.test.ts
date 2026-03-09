import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Docker from "dockerode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContainerLauncher } from "./container-launcher.js";

interface FakeContainer {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  inspect: ReturnType<typeof vi.fn>;
  id: string;
}

function makeContainer(overrides: Partial<FakeContainer> = {}): FakeContainer {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    inspect: vi.fn().mockResolvedValue({
      NetworkSettings: { Ports: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "54321" }] } },
    }),
    id: "abc123def456",
    ...overrides,
  };
}

function makeDocker(container: FakeContainer = makeContainer()): Docker {
  return { createContainer: vi.fn().mockResolvedValue(container) } as unknown as Docker;
}

let secretsDir: string;
beforeEach(async () => {
  secretsDir = await mkdtemp(join(tmpdir(), "nuke-test-"));
});
afterEach(async () => {
  await rm(secretsDir, { recursive: true, force: true });
});

describe("ContainerLauncher", () => {
  it("creates and starts container for known discipline", async () => {
    const container = makeContainer();
    const docker = makeDocker(container);
    const launcher = new ContainerLauncher({
      disciplineImages: { coder: "ghcr.io/wopr-network/wopr-nuke-coder:latest" },
      secretsDir,
      docker,
    });

    const { baseUrl } = await launcher.launch("coder");

    expect(docker.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: "ghcr.io/wopr-network/wopr-nuke-coder:latest" }),
    );
    expect(container.start).toHaveBeenCalled();
    expect(baseUrl).toBe("http://127.0.0.1:54321");
  });

  it("throws for unknown discipline", async () => {
    const launcher = new ContainerLauncher({
      disciplineImages: { coder: "ghcr.io/wopr-network/wopr-nuke-coder:latest" },
      secretsDir,
      docker: makeDocker(),
    });

    await expect(launcher.launch("unknown")).rejects.toThrow('No image configured for discipline "unknown"');
  });

  it("writes secrets to a per-launch subdir of secretsDir before container starts", async () => {
    const container = makeContainer();
    const docker = makeDocker(container);
    const launcher = new ContainerLauncher({
      disciplineImages: { coder: "img" },
      secretsDir,
      secrets: { "api-key": "tok-abc", other: "val" },
      docker,
    });

    await launcher.launch("coder");

    // Secrets go into a run-* subdirectory, not secretsDir itself
    const subdirs = await readdir(secretsDir);
    const launchDir = subdirs.find((d) => d.startsWith("run-")) ?? "";
    expect(launchDir).toBeTruthy();
    const key = await readFile(join(secretsDir, launchDir, "api-key"), "utf-8");
    const other = await readFile(join(secretsDir, launchDir, "other"), "utf-8");
    expect(key).toBe("tok-abc");
    expect(other).toBe("val");
  });

  it("mounts per-launch subdir read-only at /run/secrets", async () => {
    const container = makeContainer();
    const docker = makeDocker(container);
    const launcher = new ContainerLauncher({ disciplineImages: { coder: "img" }, secretsDir, docker });

    await launcher.launch("coder");

    const call = vi.mocked(docker.createContainer).mock.calls[0][0] as { HostConfig?: { Binds?: string[] } };
    const binds = call.HostConfig?.Binds ?? [];
    expect(binds).toHaveLength(1);
    expect(binds[0]).toMatch(new RegExp(`^${secretsDir}/run-[^/]+:/run/secrets:ro$`));
  });

  it("does not pass secrets as env vars", async () => {
    const container = makeContainer();
    const docker = makeDocker(container);
    const launcher = new ContainerLauncher({
      disciplineImages: { coder: "img" },
      secretsDir,
      secrets: { token: "supersecret" },
      docker,
    });

    await launcher.launch("coder");

    const call = vi.mocked(docker.createContainer).mock.calls[0][0] as { Env?: string[] };
    expect(call.Env ?? []).not.toContain(expect.stringContaining("supersecret"));
  });

  it("teardown stops and removes container", async () => {
    const container = makeContainer();
    const launcher = new ContainerLauncher({
      disciplineImages: { coder: "img" },
      secretsDir,
      docker: makeDocker(container),
    });

    const { teardown } = await launcher.launch("coder");
    await teardown();

    expect(container.stop).toHaveBeenCalled();
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  it("teardown cleans up per-launch secrets subdir", async () => {
    const launcher = new ContainerLauncher({
      disciplineImages: { coder: "img" },
      secretsDir,
      secrets: { token: "s3cr3t" },
      docker: makeDocker(),
    });

    const { teardown } = await launcher.launch("coder");
    const subdirsBefore = await readdir(secretsDir);
    expect(subdirsBefore.some((d) => d.startsWith("run-"))).toBe(true);

    await teardown();

    const subdirsAfter = await readdir(secretsDir);
    expect(subdirsAfter.filter((d) => d.startsWith("run-"))).toHaveLength(0);
  });

  it("teardown still removes if stop throws", async () => {
    const container = makeContainer({ stop: vi.fn().mockRejectedValue(new Error("already stopped")) });
    const launcher = new ContainerLauncher({
      disciplineImages: { coder: "img" },
      secretsDir,
      docker: makeDocker(container),
    });

    const { teardown } = await launcher.launch("coder");
    await expect(teardown()).resolves.not.toThrow();
    expect(container.remove).toHaveBeenCalled();
  });

  it("removes container and rethrows if start fails", async () => {
    const container = makeContainer({ start: vi.fn().mockRejectedValue(new Error("no such image")) });
    const docker = makeDocker(container);
    const launcher = new ContainerLauncher({ disciplineImages: { coder: "img" }, secretsDir, docker });

    await expect(launcher.launch("coder")).rejects.toThrow("no such image");
    expect(container.remove).toHaveBeenCalledWith({ force: true });
  });

  it("throws if no port binding found after start", async () => {
    const container = makeContainer({
      inspect: vi.fn().mockResolvedValue({ NetworkSettings: { Ports: { "8080/tcp": [] } } }),
    });
    const launcher = new ContainerLauncher({
      disciplineImages: { coder: "img" },
      secretsDir,
      docker: makeDocker(container),
    });

    await expect(launcher.launch("coder")).rejects.toThrow("no host port binding found");
    expect(container.stop).toHaveBeenCalled();
    expect(container.remove).toHaveBeenCalled();
  });
});
