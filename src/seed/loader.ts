import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { SeedFileSchema } from "./types.js";

export interface LoadSeedDeps {
  defconUrl: string;
  db: Database.Database;
}

export interface LoadSeedResult {
  flows: number;
  sources: number;
  watches: number;
}

/**
 * Replace $VAR and ${VAR} patterns in raw text with process.env values.
 * Only expands vars matching [A-Z_][A-Z0-9_]* to avoid false positives.
 * Throws if a referenced env var is not set.
 */
export function expandEnvVars(raw: string): string {
  return raw.replace(
    /\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g,
    (_match, braced: string | undefined, bare: string | undefined) => {
      const name = braced ?? bare ?? "";
      const value = process.env[name];
      if (value === undefined) {
        throw new Error(`Missing environment variable: ${name}`);
      }
      return value;
    },
  );
}

function ensureTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      config TEXT NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS watches (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      event TEXT NOT NULL,
      flow_name TEXT NOT NULL,
      filter TEXT,
      FOREIGN KEY (source_id) REFERENCES sources(id)
    )
  `);
}

export async function loadSeed(seedPath: string, deps: LoadSeedDeps): Promise<LoadSeedResult> {
  const absPath = resolve(seedPath);
  const raw = readFileSync(absPath, "utf-8");
  const expanded = expandEnvVars(raw);
  const json: unknown = JSON.parse(expanded);
  const seed = SeedFileSchema.parse(json);

  ensureTables(deps.db);

  for (const flow of seed.flows) {
    const res = await fetch(`${deps.defconUrl}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "admin.flow.create",
        params: {
          name: flow.name,
          initialState: flow.initialState,
          description: flow.description,
          maxConcurrent: flow.maxConcurrent,
          maxConcurrentPerRepo: flow.maxConcurrentPerRepo,
          states: flow.states.map((s) => ({
            name: s.name,
            agentRole: s.agentRole,
            modelTier: s.modelTier,
            mode: s.mode,
            promptTemplate: s.promptTemplate,
            constraints: s.constraints,
          })),
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to push flow "${flow.name}" to DEFCON: HTTP ${res.status}`);
    }
  }

  const upsertSource = deps.db.prepare("INSERT OR REPLACE INTO sources (id, type, config) VALUES (?, ?, ?)");
  for (const source of seed.sources) {
    const { id, type, ...rest } = source;
    upsertSource.run(id, type, JSON.stringify(rest));
  }

  const upsertWatch = deps.db.prepare(
    "INSERT OR REPLACE INTO watches (id, source_id, event, flow_name, filter) VALUES (?, ?, ?, ?, ?)",
  );
  for (const watch of seed.watches) {
    upsertWatch.run(
      watch.id,
      watch.sourceId,
      watch.event,
      watch.flowName,
      watch.filter ? JSON.stringify(watch.filter) : null,
    );
  }

  return {
    flows: seed.flows.length,
    sources: seed.sources.length,
    watches: seed.watches.length,
  };
}
