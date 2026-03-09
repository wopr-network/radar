import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import Docker from "dockerode";
import { logger } from "../logger.js";

export interface ContainerLauncherConfig {
  /** Maps discipline name → Docker image. e.g. { coder: "ghcr.io/wopr-network/wopr-nuke-coder:latest" } */
  disciplineImages: Record<string, string>;
  /** Parent directory under which per-launch secret subdirectories are created. */
  secretsDir: string;
  /** Secrets to write as individual files under a per-launch subdirectory. Key = filename, value = file content. */
  secrets?: Record<string, string>;
  /** Injected Docker client — defaults to socket at /var/run/docker.sock. */
  docker?: Docker;
}

export interface LaunchedContainer {
  /** http://127.0.0.1:<port> */
  baseUrl: string;
  /** Call when done — stops and removes the container, then cleans up secrets. */
  teardown: () => Promise<void>;
}

export class ContainerLauncher {
  private docker: Docker;

  constructor(private config: ContainerLauncherConfig) {
    this.docker = config.docker ?? new Docker();
  }

  async launch(discipline: string): Promise<LaunchedContainer> {
    const image = this.config.disciplineImages[discipline];
    if (!image) {
      throw new Error(`No image configured for discipline "${discipline}"`);
    }

    // Per-launch temp dir isolates secrets across concurrent launches
    const launchSecretsDir = await mkdtemp(join(this.config.secretsDir, "run-"));

    if (this.config.secrets) {
      await Promise.all(
        Object.entries(this.config.secrets).map(([name, content]) =>
          writeFile(join(launchSecretsDir, name), content, { mode: 0o600 }),
        ),
      );
    }

    let container: Docker.Container;
    try {
      container = await this.docker.createContainer({
        Image: image,
        ExposedPorts: { "8080/tcp": {} },
        HostConfig: {
          PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] }, // ephemeral port
          Binds: [`${launchSecretsDir}:/run/secrets:ro`],
          AutoRemove: false, // we remove manually after teardown logging
        },
      });
    } catch (err) {
      await rm(launchSecretsDir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }

    try {
      await container.start();
    } catch (err) {
      await container.remove({ force: true }).catch(() => undefined);
      await rm(launchSecretsDir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }

    let baseUrl: string;
    try {
      const info = await container.inspect();
      const portBinding = info.NetworkSettings.Ports["8080/tcp"]?.[0];
      if (!portBinding?.HostPort) {
        throw new Error(`Container ${container.id} started but no host port binding found`);
      }
      baseUrl = `http://127.0.0.1:${portBinding.HostPort}`;
    } catch (err) {
      await container.stop({ t: 5 }).catch(() => undefined);
      await container.remove({ force: true }).catch(() => undefined);
      await rm(launchSecretsDir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }

    logger.info(`[nuke] container started`, { id: container.id.slice(0, 12), image, baseUrl });

    const teardown = async (): Promise<void> => {
      try {
        await container.stop({ t: 5 });
      } catch {
        // already stopped
      }
      try {
        await container.remove({ force: true });
        logger.info(`[nuke] container removed`, { id: container.id.slice(0, 12) });
      } catch (err) {
        logger.warn(`[nuke] container remove failed`, {
          id: container.id.slice(0, 12),
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await rm(launchSecretsDir, { recursive: true, force: true }).catch(() => undefined);
    };

    return { baseUrl, teardown };
  }
}
