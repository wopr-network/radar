import { z } from "zod/v4";

export const SeedSourceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  repo: z.string().optional(),
  token: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const SeedWatchSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  event: z.string().min(1),
  flowName: z.string().min(1),
  signal: z.string().optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
});

export const SeedStateSchema = z
  .object({
    name: z.string().min(1),
    agentRole: z.string().optional(),
    modelTier: z.string().optional(),
    mode: z.enum(["passive", "active"]).optional(),
    promptTemplate: z.string().optional(),
    constraints: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const SeedTransitionSchema = z
  .object({
    fromState: z.string().min(1),
    toState: z.string().min(1),
    trigger: z.string().min(1),
    condition: z.string().optional(),
    priority: z.number().int().min(0).optional(),
  })
  .strict();

export const SeedFlowSchema = z
  .object({
    name: z.string().min(1),
    initialState: z.string().min(1),
    description: z.string().optional(),
    maxConcurrent: z.number().int().min(0).optional(),
    maxConcurrentPerRepo: z.number().int().min(0).optional(),
    states: z.array(SeedStateSchema).min(1),
    transitions: z.array(SeedTransitionSchema).min(1),
  })
  .strict()
  .superRefine((flow, ctx) => {
    const stateNames = new Set(flow.states.map((s) => s.name));
    for (let i = 0; i < flow.transitions.length; i++) {
      const t = flow.transitions[i];
      if (!stateNames.has(t.fromState)) {
        ctx.addIssue({
          code: "custom",
          message: `Transition #${i} has fromState "${t.fromState}" not in states`,
          path: ["transitions", i, "fromState"],
        });
      }
      if (!stateNames.has(t.toState)) {
        ctx.addIssue({
          code: "custom",
          message: `Transition #${i} has toState "${t.toState}" not in states`,
          path: ["transitions", i, "toState"],
        });
      }
    }
  });

export const SeedFileSchema = z
  .object({
    flows: z.array(SeedFlowSchema).min(1),
    sources: z.array(SeedSourceSchema).default([]),
    watches: z.array(SeedWatchSchema).default([]),
  })
  .strict()
  .superRefine((seed, ctx) => {
    // duplicate flow names
    const flowNamesSeen = new Set<string>();
    for (let i = 0; i < seed.flows.length; i++) {
      const name = seed.flows[i].name;
      if (flowNamesSeen.has(name)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate flow name "${name}"`,
          path: ["flows", i, "name"],
        });
      }
      flowNamesSeen.add(name);
    }

    // duplicate source IDs
    const sourceIdsSeen = new Set<string>();
    for (let i = 0; i < seed.sources.length; i++) {
      const id = seed.sources[i].id;
      if (sourceIdsSeen.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate source id "${id}"`,
          path: ["sources", i, "id"],
        });
      }
      sourceIdsSeen.add(id);
    }

    // duplicate watch IDs
    const watchIdsSeen = new Set<string>();
    for (let i = 0; i < seed.watches.length; i++) {
      const id = seed.watches[i].id;
      if (watchIdsSeen.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate watch id "${id}"`,
          path: ["watches", i, "id"],
        });
      }
      watchIdsSeen.add(id);
    }

    const sourceIds = new Set(seed.sources.map((s) => s.id));
    for (let i = 0; i < seed.watches.length; i++) {
      const w = seed.watches[i];
      if (!sourceIds.has(w.sourceId)) {
        ctx.addIssue({
          code: "custom",
          message: `Watch "${w.id}" references unknown source "${w.sourceId}"`,
          path: ["watches", i, "sourceId"],
        });
      }
    }
    const flowNames = new Set(seed.flows.map((f) => f.name));
    for (let i = 0; i < seed.watches.length; i++) {
      const w = seed.watches[i];
      if (!flowNames.has(w.flowName)) {
        ctx.addIssue({
          code: "custom",
          message: `Watch "${w.id}" references unknown flow "${w.flowName}"`,
          path: ["watches", i, "flowName"],
        });
      }
    }
    for (let i = 0; i < seed.flows.length; i++) {
      const f = seed.flows[i];
      const stateNames = new Set(f.states.map((s) => s.name));
      if (!stateNames.has(f.initialState)) {
        ctx.addIssue({
          code: "custom",
          message: `Flow "${f.name}" has initialState "${f.initialState}" not in its states`,
          path: ["flows", i, "initialState"],
        });
      }
    }
  });

export type SeedSource = z.infer<typeof SeedSourceSchema>;
export type SeedWatch = z.infer<typeof SeedWatchSchema>;
export type SeedFlow = z.infer<typeof SeedFlowSchema>;
export type SeedFile = z.infer<typeof SeedFileSchema>;
