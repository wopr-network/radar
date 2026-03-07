import type { RouteContext, RouteDefinition, RouteHandler, RouteResult } from "./types.js";

export class Router {
  private routes: RouteDefinition[] = [];

  add(method: string, path: string, handler: RouteHandler): void {
    const paramNames: string[] = [];
    const patternStr = path.replace(/:(\w+)/g, (_match, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    });
    const pattern = new RegExp(`^${patternStr}$`);
    this.routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
  }

  async handle(method: string, pathname: string, rawBody: string, query: URLSearchParams): Promise<RouteResult> {
    const upperMethod = method.toUpperCase();
    let pathMatched = false;

    for (const route of this.routes) {
      const match = route.pattern.exec(pathname);
      if (!match) continue;
      pathMatched = true;

      if (route.method !== upperMethod) continue;

      const params: Record<string, string> = {};
      for (let i = 0; i < route.paramNames.length; i++) {
        params[route.paramNames[i]] = match[i + 1];
      }

      let body: unknown;
      if (rawBody && (upperMethod === "POST" || upperMethod === "PUT" || upperMethod === "PATCH")) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          return { status: 400, body: { error: "Invalid JSON body" } };
        }
      }

      const ctx: RouteContext = { params, body, query };
      return route.handler(ctx);
    }

    if (pathMatched) {
      return { status: 405, body: { error: "Method not allowed" } };
    }
    return { status: 404, body: { error: "Not found" } };
  }
}
