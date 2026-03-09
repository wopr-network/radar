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
  /** Parent directory under which per-launch secret subdirectories are created. */
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
    const { entityId, workerId: slotId, modelTier, agentRole } = opts;
    const discipline = agentRole ?? "coder";

    logger.info(`[nuke] [${slotId}] START`, { entity: entityId, discipline, modelTier });

    try {
      await this.activityRepo.insert({ entityId, slotId, type: "start", data: {} });
    } catch (dbErr) {
      logger.error(`[nuke] [${slotId}] activity insert error`, {
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    }

    // Shared controller so we can distinguish timeout aborts from other errors
    const controller = new AbortController();
    let container: Awaited<ReturnType<ContainerLauncher["launch"]>> | undefined;

    try {
      container = await this.launcher.launch(discipline);

      const emitter = new SseEventEmitter({
        baseUrl: container.baseUrl,
        prompt,
        modelTier,
        timeoutMs: opts.timeout,
        abortController: controller,
      });

      return await processEvents(emitter, entityId, slotId, this.activityRepo);
    } catch (err) {
      const signal = controller.signal.aborted ? "timeout" : "crash";
      logger.error(`[nuke] [${slotId}] ${signal.toUpperCase()}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        signal,
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
