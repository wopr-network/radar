import Handlebars from "handlebars";
import type { SeedFlow } from "../seed/types.js";

export interface StateConfig {
  agentRole: string | null;
  modelTier: "opus" | "sonnet" | "haiku";
  promptTemplate: string | null;
  mode: "passive" | "active";
  meta: Record<string, unknown> | null;
}

/**
 * In-memory cache of flow definitions loaded from the seed file.
 * Radar uses this to look up dispatch config (prompt, model, role)
 * after claiming an entity from defcon.
 */
export class FlowCache {
  private flows = new Map<string, SeedFlow>();

  load(flows: SeedFlow[]): void {
    for (const flow of flows) {
      this.flows.set(flow.name, flow);
    }
  }

  getStateConfig(flowName: string, stateName: string): StateConfig | null {
    const flow = this.flows.get(flowName);
    if (!flow) return null;
    const state = flow.states.find((s) => s.name === stateName);
    if (!state) return null;
    const raw = state.modelTier ?? "sonnet";
    const modelTier: "opus" | "sonnet" | "haiku" = raw === "opus" || raw === "haiku" ? raw : "sonnet";
    return {
      agentRole: state.agentRole ?? null,
      modelTier,
      promptTemplate: state.promptTemplate ?? null,
      mode: state.mode ?? "passive",
      meta: state.meta ?? null,
    };
  }

  /**
   * Render a prompt template with Handlebars using entity refs + artifacts as context.
   */
  renderPrompt(
    template: string,
    refs: Record<string, unknown> | null,
    artifacts: Record<string, unknown> | null,
  ): string {
    const context = { ...refs, ...artifacts };
    return Handlebars.compile(template)(context);
  }

  hasFlow(flowName: string): boolean {
    return this.flows.has(flowName);
  }
}
