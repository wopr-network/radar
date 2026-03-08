import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { SeedFileSchema } from "../../src/seed/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe("seeds/wopr.seed.json", () => {
  const seedPath = resolve(__dirname, "../../seeds/wopr.seed.json");
  let parsed: ReturnType<typeof JSON.parse>;

  beforeAll(() => {
    const raw = readFileSync(seedPath, "utf-8");
    parsed = JSON.parse(raw);
  });

  function getEngineeringFlow(): { name: string; states: Array<{ name: string; mode?: string; promptTemplate?: string }>; transitions: Array<{ fromState: string; toState: string; trigger: string }>; initialState: string } {
    const flow = parsed.flows.find((f: { name: string }) => f.name === "engineering");
    expect(flow, 'Missing "engineering" flow').toBeDefined();
    return flow;
  }

  it("exists and is valid JSON", () => {
    expect(parsed).toBeDefined();
  });

  it("passes SeedFileSchema validation", () => {
    const result = SeedFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Schema validation failed: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
  });

  it("has the engineering flow with 8 states", () => {
    const flow = getEngineeringFlow();
    expect(flow.states).toHaveLength(8);
  });

  it("has 9 transitions", () => {
    const flow = getEngineeringFlow();
    expect(flow.transitions).toHaveLength(9);
  });

  it("has initialState set to backlog", () => {
    const flow = getEngineeringFlow();
    expect(flow.initialState).toBe("backlog");
  });

  it("has Linear source with env var token", () => {
    const linearSource = parsed.sources.find((s: { type: string }) => s.type === "linear");
    expect(linearSource).toBeDefined();
    expect(linearSource.token).toBe("${LINEAR_API_KEY}");
  });

  it("has watches for all WOPR domain labels", () => {
    const expectedLabels = [
      "defcon",
      "radar",
      "wopr-platform",
      "wopr-platform-ui",
      "plugin-discord",
      "plugin-msteams",
      "plugin-whatsapp",
      "security",
    ];
    for (const label of expectedLabels) {
      const watch = parsed.watches.find((w: { filter?: { labels?: string[] } }) =>
        w.filter?.labels?.includes(label),
      );
      expect(watch, `Missing watch for label "${label}"`).toBeDefined();
    }
  });

  it("all watches reference valid sources", () => {
    const sourceIds = new Set(parsed.sources.map((s: { id: string }) => s.id));
    for (const watch of parsed.watches) {
      expect(sourceIds.has(watch.sourceId), `Watch "${watch.id}" references unknown source "${watch.sourceId}"`).toBe(true);
    }
  });

  it("all watches reference valid flows", () => {
    const flowNames = new Set(parsed.flows.map((f: { name: string }) => f.name));
    for (const watch of parsed.watches) {
      expect(flowNames.has(watch.flowName), `Watch "${watch.id}" references unknown flow "${watch.flowName}"`).toBe(true);
    }
  });

  it("has no duplicate IDs", () => {
    const sourceIds = parsed.sources.map((s: { id: string }) => s.id);
    expect(new Set(sourceIds).size).toBe(sourceIds.length);
    const watchIds = parsed.watches.map((w: { id: string }) => w.id);
    expect(new Set(watchIds).size).toBe(watchIds.length);
  });

  it("all transitions reference valid states", () => {
    const flow = getEngineeringFlow();
    const stateNames = new Set(flow.states.map((s) => s.name));
    for (const t of flow.transitions) {
      expect(stateNames.has(t.fromState), `fromState "${t.fromState}" not in states`).toBe(true);
      expect(stateNames.has(t.toState), `toState "${t.toState}" not in states`).toBe(true);
    }
  });

  it("has prompt templates on active states", () => {
    const flow = getEngineeringFlow();
    const activeStates = flow.states.filter((s) => s.mode === "active");
    for (const state of activeStates) {
      expect(state.promptTemplate, `Active state "${state.name}" missing promptTemplate`).toBeDefined();
      expect(state.promptTemplate!.length).toBeGreaterThan(0);
    }
  });
});
