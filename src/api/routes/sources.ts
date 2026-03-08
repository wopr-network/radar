import type { Router } from "../router.js";
import type { Source, SourceRepo } from "../types.js";

const SENSITIVE_KEY = /secret|token|password|key|credential|auth|apikey|api_key/i;

function redactDeep(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactDeep);
  return Object.fromEntries(
    Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
      k,
      SENSITIVE_KEY.test(k) && typeof v === "string" ? "[REDACTED]" : redactDeep(v),
    ]),
  );
}

function redactSource(source: Source): Omit<Source, "config"> & { config: Record<string, unknown> } {
  return { ...source, config: redactDeep(source.config ?? {}) as Record<string, unknown> };
}

export function registerSourceRoutes(router: Router, repo: SourceRepo): void {
  router.add("GET", "/api/sources", async () => {
    const sources = await repo.findAll();
    return { status: 200, body: sources.map(redactSource) };
  });

  router.add("POST", "/api/sources", async (ctx) => {
    if (ctx.body === null || typeof ctx.body !== "object") {
      return { status: 400, body: { error: "Request body must be a JSON object" } };
    }
    const data = ctx.body as Partial<Source>;
    if (!data.name || !data.type) {
      return { status: 400, body: { error: "name and type are required" } };
    }
    const source = await repo.create({
      name: data.name,
      type: data.type,
      config: data.config ?? {},
      enabled: data.enabled ?? true,
    });
    return { status: 201, body: redactSource(source) };
  });

  router.add("GET", "/api/sources/:id", async (ctx) => {
    const source = await repo.findById(ctx.params.id);
    if (!source) return { status: 404, body: { error: "Source not found" } };
    return { status: 200, body: redactSource(source) };
  });

  router.add("PUT", "/api/sources/:id", async (ctx) => {
    if (ctx.body === null || typeof ctx.body !== "object") {
      return { status: 400, body: { error: "Request body must be a JSON object" } };
    }
    const updated = await repo.update(ctx.params.id, ctx.body as Partial<Source>);
    if (!updated) return { status: 404, body: { error: "Source not found" } };
    return { status: 200, body: redactSource(updated) };
  });

  router.add("DELETE", "/api/sources/:id", async (ctx) => {
    const deleted = await repo.delete(ctx.params.id);
    if (!deleted) return { status: 404, body: { error: "Source not found" } };
    return { status: 200, body: { deleted: true } };
  });
}
