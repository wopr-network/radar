import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expandEnvVars, loadSeed } from "../../src/seed/loader.js";
import { SeedFileSchema, SeedFlowSchema } from "../../src/seed/types.js";

function tmpSeed(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "norad-seed-"));
  const path = join(dir, "seed.json");
  writeFileSync(path, content);
  return path;
}

describe("expandEnvVars", () => {
  it("expands $VAR syntax", () => {
    process.env.TEST_VAR = "hello";
    expect(expandEnvVars("value is $TEST_VAR")).toBe("value is hello");
    delete process.env.TEST_VAR;
  });

  it("expands ${VAR} syntax", () => {
    process.env.TEST_VAR2 = "world";
    expect(expandEnvVars("value is ${TEST_VAR2}")).toBe("value is world");
    delete process.env.TEST_VAR2;
  });

  it("throws on missing env var", () => {
    delete process.env.MISSING_VAR;
    expect(() => expandEnvVars("$MISSING_VAR")).toThrow("Missing environment variable: MISSING_VAR");
  });

  it("leaves lowercase $var alone", () => {
    expect(expandEnvVars("$lowercase")).toBe("$lowercase");
  });

  it("expands multiple vars in one string", () => {
    process.env.A_VAR = "a";
    process.env.B_VAR = "b";
    expect(expandEnvVars("$A_VAR and ${B_VAR}")).toBe("a and b");
    delete process.env.A_VAR;
    delete process.env.B_VAR;
  });
});

describe("loadSeed", () => {
  let db: InstanceType<typeof Database>;

  const validSeed = {
    flows: [
      {
        name: "test-flow",
        initialState: "open",
        description: "A test flow",
        states: [
          { name: "open", agentRole: "triage", mode: "passive" },
          { name: "closed", agentRole: "closer", mode: "passive" },
        ],
        transitions: [{ fromState: "open", toState: "closed", trigger: "done" }],
      },
    ],
    sources: [{ id: "src-1", type: "github", repo: "org/repo" }],
    watches: [{ id: "w-1", sourceId: "src-1", event: "push", flowName: "test-flow" }],
  };

  beforeEach(() => {
    db = new Database(":memory:");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("parses valid seed, pushes flow to DEFCON, upserts sources and watches", async () => {
    const seedPath = tmpSeed(JSON.stringify(validSeed));
    const result = await loadSeed(seedPath, { defconUrl: "http://localhost:3000", db });

    expect(result).toEqual({ flows: 1, sources: 1, watches: 1 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toBe("http://localhost:3000/api/flows/test-flow");
    expect((call[1] as RequestInit).method).toBe("PUT");
    const body = JSON.parse((call[1] as RequestInit).body as string) as { definition: { initialState: string } };
    expect(body.definition.initialState).toBe("open");

    const sources = db.prepare("SELECT * FROM sources").all() as Array<{ id: string; type: string; config: string }>;
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe("src-1");
    expect(sources[0].type).toBe("github");

    const watches = db.prepare("SELECT * FROM watches").all() as Array<{
      id: string;
      source_id: string;
      event: string;
      flow_name: string;
    }>;
    expect(watches).toHaveLength(1);
    expect(watches[0].id).toBe("w-1");
    expect(watches[0].source_id).toBe("src-1");
    expect(watches[0].flow_name).toBe("test-flow");
  });

  it("expands env vars in seed file before parsing", async () => {
    process.env.SEED_REPO = "my-org/my-repo";
    const seedWithVar = {
      ...validSeed,
      sources: [{ id: "src-1", type: "github", repo: "$SEED_REPO" }],
    };
    const seedPath = tmpSeed(JSON.stringify(seedWithVar));
    const result = await loadSeed(seedPath, { defconUrl: "http://localhost:3000", db });

    expect(result.sources).toBe(1);
    const sources = db.prepare("SELECT * FROM sources").all() as Array<{ config: string }>;
    const config = JSON.parse(sources[0].config) as { repo: string };
    expect(config.repo).toBe("my-org/my-repo");
    delete process.env.SEED_REPO;
  });

  it("throws on missing env var in seed", async () => {
    delete process.env.NONEXISTENT;
    const seedWithMissing = JSON.stringify(validSeed).replace("org/repo", "$NONEXISTENT");
    const seedPath = tmpSeed(seedWithMissing);

    await expect(loadSeed(seedPath, { defconUrl: "http://localhost:3000", db })).rejects.toThrow(
      "Missing environment variable: NONEXISTENT",
    );
  });

  it("throws descriptive error on invalid seed file", async () => {
    const seedPath = tmpSeed(JSON.stringify({ flows: [] }));

    await expect(loadSeed(seedPath, { defconUrl: "http://localhost:3000", db })).rejects.toThrow();
  });

  it("throws when DEFCON returns non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '{"error":"internal"}' }),
    );
    const seedPath = tmpSeed(JSON.stringify(validSeed));

    await expect(loadSeed(seedPath, { defconUrl: "http://localhost:3000", db })).rejects.toThrow(
      '{"error":"internal"}',
    );
  });

  it("includes transitions in DEFCON payload", async () => {
    const seedPath = tmpSeed(JSON.stringify(validSeed));
    await loadSeed(seedPath, { defconUrl: "http://localhost:3000", db });

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string) as {
      definition: { transitions: Array<{ fromState: string; toState: string }> };
    };
    expect(body.definition.transitions).toBeDefined();
    expect(body.definition.transitions).toHaveLength(1);
    expect(body.definition.transitions[0].fromState).toBe("open");
    expect(body.definition.transitions[0].toState).toBe("closed");
  });

  it("stores token fields as env-var references, never expands them to plaintext", async () => {
    process.env.SEED_TOKEN = 'token"with"quotes';
    const seedWithToken = {
      ...validSeed,
      sources: [{ id: "src-1", type: "github", repo: "org/repo", token: "$SEED_TOKEN" }],
    };
    const seedPath = tmpSeed(JSON.stringify(seedWithToken));
    const result = await loadSeed(seedPath, { defconUrl: "http://localhost:3000", db });
    expect(result.sources).toBe(1);
    const sources = db.prepare("SELECT * FROM sources").all() as Array<{ config: string }>;
    const config = JSON.parse(sources[0].config) as { token: string };
    // Token must remain as the env-var reference, not the expanded plaintext value.
    expect(config.token).toBe("$SEED_TOKEN");
    delete process.env.SEED_TOKEN;
  });

  it("throws when upserts fail mid-transaction (atomicity)", async () => {
    const seedPath = tmpSeed(JSON.stringify(validSeed));
    await loadSeed(seedPath, { defconUrl: "http://localhost:3000", db });
    const sources = db.prepare("SELECT * FROM sources").all();
    expect(sources).toHaveLength(1);
  });

  it("throws on duplicate flow names in seed", async () => {
    const dupSeed = {
      ...validSeed,
      flows: [
        validSeed.flows[0],
        { ...validSeed.flows[0], initialState: "open" },
      ],
    };
    const seedPath = tmpSeed(JSON.stringify(dupSeed));
    await expect(loadSeed(seedPath, { defconUrl: "http://localhost:3000", db })).rejects.toThrow(
      /duplicate/i,
    );
  });

  it("throws on duplicate source IDs in seed", async () => {
    const dupSeed = {
      ...validSeed,
      sources: [validSeed.sources[0], validSeed.sources[0]],
    };
    const seedPath = tmpSeed(JSON.stringify(dupSeed));
    await expect(loadSeed(seedPath, { defconUrl: "http://localhost:3000", db })).rejects.toThrow(
      /duplicate/i,
    );
  });

  it("throws on duplicate watch IDs in seed", async () => {
    const dupSeed = {
      ...validSeed,
      watches: [validSeed.watches[0], validSeed.watches[0]],
    };
    const seedPath = tmpSeed(JSON.stringify(dupSeed));
    await expect(loadSeed(seedPath, { defconUrl: "http://localhost:3000", db })).rejects.toThrow(
      /duplicate/i,
    );
  });

  it("is idempotent — running twice does not error", async () => {
    const seedPath = tmpSeed(JSON.stringify(validSeed));
    await loadSeed(seedPath, { defconUrl: "http://localhost:3000", db });
    await loadSeed(seedPath, { defconUrl: "http://localhost:3000", db });

    const sources = db.prepare("SELECT * FROM sources").all();
    expect(sources).toHaveLength(1);
  });

  it("throws on watch referencing unknown source", async () => {
    const badSeed = {
      ...validSeed,
      watches: [{ id: "w-1", sourceId: "nonexistent", event: "push", flowName: "test-flow" }],
    };
    const seedPath = tmpSeed(JSON.stringify(badSeed));

    await expect(loadSeed(seedPath, { defconUrl: "http://localhost:3000", db })).rejects.toThrow();
  });

  it("throws on watch referencing unknown flow", async () => {
    const badSeed = {
      ...validSeed,
      watches: [{ id: "w-1", sourceId: "src-1", event: "push", flowName: "nonexistent" }],
    };
    const seedPath = tmpSeed(JSON.stringify(badSeed));

    await expect(loadSeed(seedPath, { defconUrl: "http://localhost:3000", db })).rejects.toThrow();
  });
});

describe("SeedFileSchema validation", () => {
  const baseFlow = {
    name: "f1",
    initialState: "open",
    states: [
      { name: "open" },
      { name: "closed" },
    ],
    transitions: [{ fromState: "open", toState: "closed", trigger: "done" }],
  };

  it("rejects transition with fromState not in states", () => {
    const result = SeedFlowSchema.safeParse({
      ...baseFlow,
      transitions: [{ fromState: "nonexistent", toState: "closed", trigger: "done" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects transition with toState not in states", () => {
    const result = SeedFlowSchema.safeParse({
      ...baseFlow,
      transitions: [{ fromState: "open", toState: "nonexistent", trigger: "done" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys in nested flow schema (strict)", () => {
    const result = SeedFlowSchema.safeParse({
      ...baseFlow,
      unknownKey: "surprise",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys in nested state schema (strict)", () => {
    const result = SeedFlowSchema.safeParse({
      ...baseFlow,
      states: [{ name: "open", unknownKey: "surprise" }, { name: "closed" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate flow names", () => {
    const result = SeedFileSchema.safeParse({
      flows: [baseFlow, { ...baseFlow }],
      sources: [],
      watches: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate source IDs", () => {
    const result = SeedFileSchema.safeParse({
      flows: [baseFlow],
      sources: [{ id: "s1", type: "github" }, { id: "s1", type: "github" }],
      watches: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate watch IDs", () => {
    const result = SeedFileSchema.safeParse({
      flows: [baseFlow],
      sources: [{ id: "s1", type: "github" }],
      watches: [
        { id: "w1", sourceId: "s1", event: "push", flowName: "f1" },
        { id: "w1", sourceId: "s1", event: "push", flowName: "f1" },
      ],
    });
    expect(result.success).toBe(false);
  });
});
