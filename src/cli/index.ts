#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { logger } from "../logger.js";
import { renderWorkerPrompt } from "./worker-prompt.js";

const require = createRequire(import.meta.url);
const { version } = require("../../package.json") as { version: string };

export const VALID_DISCIPLINES = ["engineering", "devops", "qa", "security"] as const;

/**
 * Parse raw --role flag values into typed {discipline, count} pairs.
 *
 * Rules:
 *  - Each entry is "discipline" or "discipline:count" (exactly one colon max).
 *  - Extra colon segments (e.g. "engineering:6:extra") are rejected.
 *  - Multiple bare disciplines combined with --workers is rejected; use
 *    "discipline:count" syntax when specifying more than one discipline.
 *  - A single bare discipline inherits `workers` (defaulting to 1).
 *
 * Throws an Error with a human-readable message on any validation failure.
 */
export function parseRoles(
  rawRoles: string[],
  workers: number | undefined,
): Array<{ discipline: string; count: number }> {
  // Count bare (no-colon) entries upfront to detect multi-bare ambiguity early
  const bareRoles = rawRoles.filter((r) => !r.includes(":"));
  if (bareRoles.length > 1) {
    throw new Error(
      `Error: Use --pool for multiple disciplines: --role engineering:N --role devops:M. ` +
        `Bare --role shorthand only works for a single discipline.`,
    );
  }

  const roles: Array<{ discipline: string; count: number }> = [];

  for (const raw of rawRoles) {
    const parts = raw.split(":");
    const discipline = parts[0];

    if (parts.length > 2) {
      throw new Error(`Error: invalid --role format "${raw}". Expected "discipline" or "discipline:count"`);
    }

    if (!(VALID_DISCIPLINES as readonly string[]).includes(discipline)) {
      throw new Error(`Error: invalid role "${discipline}". Must be one of: ${VALID_DISCIPLINES.join(", ")}`);
    }

    if (parts.length > 1) {
      const count = Number.parseInt(parts[1], 10);
      if (Number.isNaN(count) || count < 1) {
        throw new Error(`Error: count must be a positive integer in "${raw}"`);
      }
      roles.push({ discipline, count });
    } else {
      // Single bare discipline — inherit --workers (default 1)
      const count = workers != null && !Number.isNaN(workers) ? workers : 1;
      roles.push({ discipline, count });
    }
  }

  return roles;
}

export function buildProgram(): Command {
  const program = new Command();
  program.name("radar").description("The only winning move is to have gates.").version(version);

  program
    .command("run")
    .description("Start the worker pool")
    .option("-w, --workers <n>", "Number of worker slots (optional when counts are in --role)", (v: string) =>
      Number.parseInt(v, 10),
    )
    .option("-r, --role <role...>", "Worker discipline(s). Format: discipline or discipline:count", [])
    .option("-f, --flow <flow>", "Restrict to a specific flow")
    .option("--max-concurrent <n>", "Max concurrent entities for the flow", (v: string) => Number.parseInt(v, 10))
    .option("--max-concurrent-per-repo <n>", "Max concurrent entities per repo", (v: string) => Number.parseInt(v, 10))
    .option("--worker <type>", "Worker type identifier")
    .option("--dummy", "Use dummy dispatcher (no Claude API calls, for testing)")
    .option("--agents-dir <path>", "Directory containing agent MD files", process.env.RADAR_AGENTS_DIR)
    .option("--seed <path>", "Seed file path")
    .option("--defcon-url <url>", "DEFCON server URL", "http://localhost:3000")
    .option("--worker-token <token>", "DEFCON worker token for claiming work", process.env.DEFCON_WORKER_TOKEN)
    .option("--admin-token <token>", "DEFCON admin token for seeding flows", process.env.DEFCON_ADMIN_TOKEN)
    .option("--port <n>", "API server port", (v: string) => Number.parseInt(v, 10), 8080)
    .action(async (opts) => {
      if (opts.workers != null && (Number.isNaN(opts.workers) || opts.workers <= 0)) {
        logger.error(`Error: --workers must be a positive integer, got "${opts.workers}"`);
        process.exit(1);
      }

      // Parse roles: each entry is either "discipline" or "discipline:count"
      const rawRoles = (opts.role ?? []) as string[];
      if (rawRoles.length === 0) {
        logger.error("Error: at least one --role is required");
        process.exit(1);
      }

      let roles: Array<{ discipline: string; count: number }>;
      try {
        roles = parseRoles(rawRoles, opts.workers as number | undefined);
      } catch (err) {
        logger.error((err as Error).message);
        process.exit(1);
      }

      const totalWorkers = roles.reduce((sum, r) => sum + r.count, 0);
      opts.roles = roles;
      opts.workers = totalWorkers;

      if (opts.maxConcurrent != null && (Number.isNaN(opts.maxConcurrent) || opts.maxConcurrent < 1)) {
        logger.error(`Invalid --max-concurrent: ${opts.maxConcurrent}`);
        process.exit(1);
      }

      if (
        opts.maxConcurrentPerRepo != null &&
        (Number.isNaN(opts.maxConcurrentPerRepo) || opts.maxConcurrentPerRepo < 1)
      ) {
        logger.error(`Invalid --max-concurrent-per-repo: ${opts.maxConcurrentPerRepo}`);
        process.exit(1);
      }

      const port = opts.port as number;
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        logger.error(`Invalid port: ${String(opts.port)}`);
        process.exit(1);
      }

      const { createDb } = await import("../db/index.js");
      const { SourceRepo: DbSourceRepo } = await import("../db/repos/source-repo.js");
      const { WatchRepo: DbWatchRepo } = await import("../db/repos/watch-repo.js");
      const { WorkerRepo: DbWorkerRepo } = await import("../db/repos/worker-repo.js");
      const { EventLogRepo: DbEventLogRepo } = await import("../db/repos/event-log-repo.js");
      const { DrizzleEntityMapRepository } = await import("../db/repos/entity-map-repo.js");
      const { Ingestor } = await import("../ingestion/ingestor.js");
      const { sources: sourcesTable, watches: watchesTable } = await import("../db/schema.js");

      const radarDb = createDb(":memory:");
      const entityMapRepo = new DrizzleEntityMapRepository(radarDb);
      const dbSourceRepo = new DbSourceRepo(radarDb);
      const dbWatchRepo = new DbWatchRepo(radarDb);
      const dbWorkerRepo = new DbWorkerRepo(radarDb);
      const dbEventLogRepo = new DbEventLogRepo(radarDb);

      if (opts.seed) {
        const { createDb } = await import("../db/index.js");
        const { loadSeed, expandEnvVarsInValue } = await import("../seed/loader.js");
        const { SeedFileSchema } = await import("../seed/types.js");
        const { readFileSync } = await import("node:fs");
        const { resolve } = await import("node:path");

        const seedDb = createDb(":memory:");
        let seedResult: { flows: number; sources: number; watches: number };
        try {
          seedResult = await loadSeed(opts.seed as string, {
            defconUrl: opts.defconUrl as string,
            db: seedDb,
            adminToken: opts.adminToken,
          });
        } catch (err) {
          logger.error(`[radar] Seed failed`, { error: (err as Error).message });
          process.exit(1);
        }

        // Re-parse seed to populate drizzle DB so API server can serve sources/watches
        try {
          const absPath = resolve(opts.seed as string);
          const rawText = readFileSync(absPath, "utf-8");
          const seed = SeedFileSchema.parse(expandEnvVarsInValue(JSON.parse(rawText)));
          const now = Math.floor(Date.now() / 1000);
          for (const source of seed.sources) {
            const { id, type, config, ...rest } = source;
            radarDb
              .insert(sourcesTable)
              .values({
                id,
                name: id,
                type,
                config: JSON.stringify({ ...(config ?? {}), ...rest }),
                enabled: true,
                createdAt: now,
                updatedAt: now,
              })
              .run();
          }
          for (const watch of seed.watches) {
            radarDb
              .insert(watchesTable)
              .values({
                id: watch.id,
                sourceId: watch.sourceId,
                name: watch.id,
                filter: JSON.stringify(watch.filter ?? {}),
                action: watch.event,
                actionConfig: JSON.stringify({
                  flowName: watch.flowName,
                  ...(watch.signal ? { signal: watch.signal } : {}),
                }),
                enabled: true,
                createdAt: now,
                updatedAt: now,
              })
              .run();
          }
        } catch (err) {
          logger.error(`[radar] Failed to populate API DB from seed`, { error: (err as Error).message });
          process.exit(1);
        }

        logger.info(
          `[radar] Seed loaded: ${seedResult.flows} flows, ${seedResult.sources} sources, ${seedResult.watches} watches`,
        );
      }

      const { Pool } = await import("../pool/pool.js");
      const { DefconClient } = await import("../defcon/client.js");
      const { SdkDispatcher } = await import("../dispatcher/sdk-dispatcher.js");
      const { DrizzleEntityActivityRepo } = await import("../db/repos/drizzle-entity-activity-repo.js");
      const { RunLoop } = await import("../run-loop/run-loop.js");
      const { createServer } = await import("../api/server.js");
      const { SourceAdapterRegistry } = await import("../sources/adapter.js");
      const { LinearSourceAdapter } = await import("../sources/linear-adapter.js");
      const { GenericSourceAdapter } = await import("../sources/generic-adapter.js");

      const pool = new Pool(totalWorkers);
      const defcon = new DefconClient({ url: opts.defconUrl, workerToken: opts.workerToken });
      const ingestor = new Ingestor(entityMapRepo, defcon);
      const activityRepo = new DrizzleEntityActivityRepo(radarDb);

      if (!opts.dummy && process.getuid?.() === 0) {
        logger.error(
          "[radar] SdkDispatcher requires a non-root user (bypassPermissions is blocked when running as root). Re-run as a non-root user or pass --dummy for testing.",
        );
        process.exit(1);
      }

      const dispatcher = opts.dummy
        ? new (await import("../dispatcher/dummy-dispatcher.js")).DummyDispatcher(activityRepo)
        : new SdkDispatcher(activityRepo, opts.agentsDir as string | undefined);

      // Adapters: bridge drizzle repo method names to AppDeps interface
      const sourceRepo = {
        findAll: async () =>
          dbSourceRepo.list().map((r) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            config: r.config,
            enabled: r.enabled,
            created_at: r.createdAt,
            updated_at: r.updatedAt,
          })),
        findById: async (id: string) => {
          const r = dbSourceRepo.getById(id);
          return r
            ? {
                id: r.id,
                name: r.name,
                type: r.type,
                config: r.config,
                enabled: r.enabled,
                created_at: r.createdAt,
                updated_at: r.updatedAt,
              }
            : undefined;
        },
        create: async (data: { name: string; type: string; config: Record<string, unknown>; enabled?: boolean }) => {
          const r = dbSourceRepo.create(data);
          return {
            id: r.id,
            name: r.name,
            type: r.type,
            config: r.config,
            enabled: r.enabled,
            created_at: r.createdAt,
            updated_at: r.updatedAt,
          };
        },
        update: async (
          id: string,
          data: { name?: string; type?: string; config?: Record<string, unknown>; enabled?: boolean },
        ) => {
          const r = dbSourceRepo.update(id, data);
          return r
            ? {
                id: r.id,
                name: r.name,
                type: r.type,
                config: r.config,
                enabled: r.enabled,
                created_at: r.createdAt,
                updated_at: r.updatedAt,
              }
            : undefined;
        },
        delete: async (id: string) => {
          dbSourceRepo.delete(id);
          return true;
        },
      };

      const watchRepo = {
        findBySourceId: async (sourceId: string) =>
          dbWatchRepo.listBySource(sourceId).map((r) => ({
            id: r.id,
            source_id: r.sourceId,
            name: r.name,
            filter: r.filter,
            action: r.action,
            action_config: r.actionConfig,
            enabled: r.enabled,
            created_at: r.createdAt,
            updated_at: r.updatedAt,
          })),
        findById: async (id: string) => {
          const r = dbWatchRepo.getById(id);
          return r
            ? {
                id: r.id,
                source_id: r.sourceId,
                name: r.name,
                filter: r.filter,
                action: r.action,
                action_config: r.actionConfig,
                enabled: r.enabled,
                created_at: r.createdAt,
                updated_at: r.updatedAt,
              }
            : undefined;
        },
        create: async (data: {
          source_id: string;
          name: string;
          filter: Record<string, unknown>;
          action: string;
          action_config: Record<string, unknown>;
          enabled?: boolean;
        }) => {
          const r = dbWatchRepo.create({
            sourceId: data.source_id,
            name: data.name,
            filter: data.filter,
            action: data.action,
            actionConfig: data.action_config,
            enabled: data.enabled,
          });
          return {
            id: r.id,
            source_id: r.sourceId,
            name: r.name,
            filter: r.filter,
            action: r.action,
            action_config: r.actionConfig,
            enabled: r.enabled,
            created_at: r.createdAt,
            updated_at: r.updatedAt,
          };
        },
        update: async (
          id: string,
          data: {
            name?: string;
            filter?: Record<string, unknown>;
            action?: string;
            action_config?: Record<string, unknown>;
            enabled?: boolean;
          },
        ) => {
          const r = dbWatchRepo.update(id, {
            name: data.name,
            filter: data.filter,
            action: data.action,
            actionConfig: data.action_config,
            enabled: data.enabled,
          });
          return r
            ? {
                id: r.id,
                source_id: r.sourceId,
                name: r.name,
                filter: r.filter,
                action: r.action,
                action_config: r.actionConfig,
                enabled: r.enabled,
                created_at: r.createdAt,
                updated_at: r.updatedAt,
              }
            : undefined;
        },
        delete: async (id: string) => {
          dbWatchRepo.delete(id);
          return true;
        },
      };

      const workerRepo = dbWorkerRepo;

      const eventLogRepo = {
        findAll: async (findAllOpts?: { limit?: number; offset?: number }) => {
          const all = dbEventLogRepo.list(findAllOpts);
          return all.map((r) => ({
            id: r.id,
            source_id: r.sourceId,
            watch_id: r.watchId,
            raw_event: r.rawEvent,
            action_taken: r.actionTaken,
            defcon_response: r.defconResponse,
            created_at: r.createdAt,
          }));
        },
        append: async (data: {
          source_id: string;
          watch_id: string | null;
          raw_event: unknown;
          action_taken: string | null;
          defcon_response: unknown;
        }) => {
          const r = dbEventLogRepo.append({
            sourceId: data.source_id,
            watchId: data.watch_id,
            rawEvent: data.raw_event as Record<string, unknown>,
            actionTaken: data.action_taken,
            defconResponse: data.defcon_response as Record<string, unknown> | null,
          });
          return {
            id: r.id,
            source_id: r.sourceId,
            watch_id: r.watchId,
            raw_event: r.rawEvent,
            action_taken: r.actionTaken,
            defcon_response: r.defconResponse,
            created_at: r.createdAt,
          };
        },
      };

      const adapterRegistry = new SourceAdapterRegistry();
      adapterRegistry.register(new LinearSourceAdapter());
      adapterRegistry.register(new GenericSourceAdapter());

      const apiServer = createServer({
        sourceRepo,
        watchRepo,
        workerRepo,
        eventLogRepo,
        activityRepo,
        pool,
        defconClient: defcon,
        adapterRegistry,
        onWebhook: async (_sourceId: string, event: import("../ingestion/types.js").IngestEvent) => {
          await ingestor.ingest(event);
        },
      });

      await new Promise<void>((res) => apiServer.listen(port, res));
      logger.info(`[radar] API server listening on port ${port}`);

      const loop = new RunLoop({
        pool,
        defcon,
        dispatcher,
        activityRepo,
        workerRepo,
        workerType: opts.worker ?? "wopr",
        workerDiscipline: (opts.roles as Array<{ discipline: string; count: number }>)[0]?.discipline,
        roles: opts.roles as Array<{ discipline: string; count: number }>,
        flow: opts.flow,
        workerIdPrefix: opts.worker,
        pollIntervalMs: 5000,
        maxConcurrent: opts.maxConcurrent,
        maxConcurrentPerRepo: opts.maxConcurrentPerRepo,
      });

      const rolesDesc = (opts.roles as Array<{ discipline: string; count: number }>)
        .map((r) => `${r.discipline}:${r.count}`)
        .join(", ");
      logger.info(
        `[radar] Starting ${totalWorkers} worker slots — roles: ${rolesDesc}${opts.flow ? ` — flow: ${opts.flow}` : ""}${opts.worker ? ` — worker: ${opts.worker}` : ""}`,
      );
      await loop.start();

      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info("[radar] Shutting down gracefully...");
        await loop.stop();
        await new Promise<void>((res) => apiServer.close(() => res()));
        logger.info("[radar] All slots stopped.");
        process.exit(0);
      };

      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });

  const worker = program.command("worker").description("Worker management");

  worker
    .command("new")
    .description("Register a new worker and print its bootstrap prompt")
    .requiredOption("-d, --discipline <discipline>", "Worker discipline (engineering, devops, qa, security)")
    .option("--defcon-url <url>", "DEFCON server URL", "http://localhost:3000")
    .option("--worker-id <id>", "Use a specific worker ID instead of generating one")
    .action((opts) => {
      if (!(VALID_DISCIPLINES as readonly string[]).includes(opts.discipline)) {
        logger.error(`Error: invalid discipline "${opts.discipline}". Must be one of: ${VALID_DISCIPLINES.join(", ")}`);
        process.exit(1);
      }
      const workerId = opts.workerId ?? `wkr-${randomUUID()}`;
      const prompt = renderWorkerPrompt({
        workerId,
        discipline: opts.discipline,
        defconUrl: opts.defconUrl,
      });
      process.stdout.write(`${prompt}\n`);
    });

  program
    .command("seed")
    .description(
      "Push seed file to DEFCON and local DB.\n" +
        "  Expected JSON shape: { flows: Flow[], sources: Source[], watches: Watch[] }\n" +
        "  where each Flow has { name, initialState, states, transitions, ... },\n" +
        "  each Source has { id, type, token?, config? },\n" +
        "  and each Watch has { id, sourceId, event, flowName, filter? }.",
    )
    .argument("<path>", "Path to the seed JSON file")
    .option("--defcon-url <url>", "DEFCON server URL", "http://localhost:3000")
    .requiredOption(
      "--db <path>",
      "Local SQLite database path (required — use a dedicated seed DB, not the live radar.db)",
    )
    .action(async (seedPath: string, opts: { defconUrl: string; db: string }) => {
      const { runSeed } = await import("./seed-action.js");
      try {
        await runSeed({ seedPath, defconUrl: opts.defconUrl, db: opts.db });
      } catch (err) {
        logger.error(`[radar] Seed failed`, { error: err instanceof Error ? err.message : String(err) });
        process.exit(1);
      }
    });

  return program;
}

// Only auto-parse when run as the entry point, not when imported in tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await buildProgram().parseAsync();
}
