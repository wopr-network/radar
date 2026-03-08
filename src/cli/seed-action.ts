import { createDb } from "../db/index.js";
import { loadSeed } from "../seed/loader.js";

export interface RunSeedOpts {
  seedPath: string;
  defconUrl: string;
  db: string;
}

export async function runSeed(opts: RunSeedOpts): Promise<void> {
  const db = createDb(opts.db);
  try {
    const result = await loadSeed(opts.seedPath, { defconUrl: opts.defconUrl, db });
    console.log(`[norad] Seeded: ${result.flows} flows, ${result.sources} sources, ${result.watches} watches`);
  } finally {
    db.$client.close();
  }
}
