import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import Docker from "dockerode";
import { logger } from "../logger.js";

export interface ContainerLauncherConfig {
  /** Maps discipline name → Docker image. e.g. { coder: "ghcr.io/wopr-network/wopr-nuke-coder:latest" } */
  disciplineImages: Record<string, string>;
  /** Directory radar writes credential files into before container start. Mounted read-only at /run/secrets. */
  secretsDir: string;
  /** Secrets to write as individual files under secretsDir. Key = filename, value = file content. */
  secrets?: Record<string, string>;
  /** Injected Docker client — defaults to socket at /var/run/docker.sock. */
  docker?: Docker;
}

export interface LaunchedContainer {
  /** http://127.0.0.1:<port> */
  baseUrl: string;
  /** Call when done — stops and removes the container. */
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

    // Write secrets to secretsDir before container starts
    if (this.config.secrets) {
      await Promise.all(
        Object.entries(this.config.secrets).map(([name, content]) =>
          writeFile(join(this.config.secretsDir, name), content, { mode: 0o600 }),
        ),
      );
    }

    const container = await this.docker.createContainer({
      Image: image,
      ExposedPorts: { "8080/tcp": {} },
      HostConfig: {
        PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }] }, // ephemeral port
        Binds: [`${this.config.secretsDir}:/run/secrets:ro`],
        AutoRemove: false, // we remove manually after teardown logging
      },
    });

    try {
      await container.start();
    } catch (err) {
      await container.remove({ force: true }).catch(() => undefined);
      throw err;
    }

    const info = await container.inspect();
    const portBinding = info.NetworkSettings.Ports["8080/tcp"]?.[0];
    if (!portBinding?.HostPort) {
      await container.stop().catch(() => undefined);
      await container.remove({ force: true }).catch(() => undefined);
      throw new Error(`Container ${container.id} started but no host port binding found`);
    }

    const baseUrl = `http://127.0.0.1:${portBinding.HostPort}`;
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
    };

    return { baseUrl, teardown };
  }
}
