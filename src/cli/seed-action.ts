import Database from "better-sqlite3";
import { loadSeed } from "../seed/loader.js";

export interface RunSeedOpts {
  seedPath: string;
  defconUrl: string;
  db: string;
}

export async function runSeed(opts: RunSeedOpts): Promise<void> {
  const db = new Database(opts.db);
  try {
    const result = await loadSeed(opts.seedPath, { defconUrl: opts.defconUrl, db });
    console.log(`[norad] Seeded: ${result.flows} flows, ${result.sources} sources, ${result.watches} watches`);
  } finally {
    db.close();
  }
}
