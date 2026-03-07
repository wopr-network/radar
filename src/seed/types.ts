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
  filter: z.record(z.string(), z.unknown()).optional(),
});

export const SeedStateSchema = z.object({
  name: z.string().min(1),
  agentRole: z.string().optional(),
  modelTier: z.string().optional(),
  mode: z.enum(["passive", "active"]).optional(),
  promptTemplate: z.string().optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
});

export const SeedTransitionSchema = z.object({
  fromState: z.string().min(1),
  toState: z.string().min(1),
  trigger: z.string().min(1),
  condition: z.string().optional(),
  priority: z.number().int().min(0).optional(),
});

export const SeedFlowSchema = z.object({
  name: z.string().min(1),
  initialState: z.string().min(1),
  description: z.string().optional(),
  maxConcurrent: z.number().int().min(0).optional(),
  maxConcurrentPerRepo: z.number().int().min(0).optional(),
  states: z.array(SeedStateSchema).min(1),
  transitions: z.array(SeedTransitionSchema).min(1),
});

export const SeedFileSchema = z
  .object({
    flows: z.array(SeedFlowSchema).min(1),
    sources: z.array(SeedSourceSchema).default([]),
    watches: z.array(SeedWatchSchema).default([]),
  })
  .strict()
  .superRefine((seed, ctx) => {
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
