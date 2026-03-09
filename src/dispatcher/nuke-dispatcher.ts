import type Docker from "dockerode";
import type { IEntityActivityRepo } from "../db/repos/entity-activity-repo.js";
import { logger } from "../logger.js";
import { ContainerLauncher } from "./container-launcher.js";
import { processEvents } from "./process-events.js";
import { SseEventEmitter } from "./sse-event-emitter.js";
import type { DispatchOpts, INukeDispatcher, WorkerResult } from "./types.js";

export interface NukeConfig {
  /** Maps discipline name → Docker image. e.g. { coder: "ghcr.io/wopr-network/wopr-nuke-coder:latest" } */
  disciplineImages: Record<string, string>;
  /** Directory radar writes credential files into before container start. Mounted read-only at /run/secrets. */
  secretsDir: string;
  /** Secrets to write as individual files — key = filename, value = content. */
  secrets?: Record<string, string>;
  /** Injected Docker client for testability. */
  docker?: Docker;
}

export class NukeDispatcher implements INukeDispatcher {
  private launcher: ContainerLauncher;

  constructor(
    private activityRepo: IEntityActivityRepo,
    config: NukeConfig,
  ) {
    this.launcher = new ContainerLauncher({
      disciplineImages: config.disciplineImages,
      secretsDir: config.secretsDir,
      secrets: config.secrets,
      docker: config.docker,
    });
  }

  async dispatch(prompt: string, opts: DispatchOpts): Promise<WorkerResult> {
    const { entityId, workerId: slotId, modelTier, agentRole: discipline = "coder" } = opts;

    logger.info(`[nuke] [${slotId}] START`, { entity: entityId, discipline, modelTier });

    try {
      await this.activityRepo.insert({ entityId, slotId, type: "start", data: {} });
    } catch (dbErr) {
      logger.error(`[nuke] [${slotId}] activity insert error`, {
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }

    let container: Awaited<ReturnType<ContainerLauncher["launch"]>> | undefined;

    try {
      container = await this.launcher.launch(discipline ?? "coder");

      const emitter = new SseEventEmitter({
        baseUrl: container.baseUrl,
        prompt,
        modelTier,
        timeoutMs: opts.timeout,
      });

      return await processEvents(emitter, entityId, slotId, this.activityRepo);
    } catch (err) {
      logger.error(`[nuke] [${slotId}] ERROR`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        signal: "crash",
        artifacts: { error: err instanceof Error ? err.message : String(err) },
        exitCode: -1,
      };
    } finally {
      if (container) {
        await container.teardown();
      }
    }
  }
}
