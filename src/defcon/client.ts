import type { ClaimResponse, CreateEntityResponse, ReportResponse } from "./types.js";

export interface DefconClientConfig {
  url: string;
}

export class DefconClient {
  private url: string;

  constructor(config: DefconClientConfig) {
    this.url = config.url;
  }

  async claim(params: { workerId?: string; role: string; flow?: string }): Promise<ClaimResponse> {
    const res = await fetch(`${this.url}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "flow.claim", params }),
    });
    if (!res.ok) throw new Error(`flow.claim failed: ${res.status}`);
    return res.json() as Promise<ClaimResponse>;
  }

  async createEntity(params: { flowName: string; payload: Record<string, unknown> }): Promise<CreateEntityResponse> {
    const signal = AbortSignal.timeout(30_000);
    const res = await fetch(`${this.url}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "admin.entity.create", params }),
      signal,
    });
    if (!res.ok) throw new Error(`admin.entity.create failed: ${res.status}`);
    return res.json() as Promise<CreateEntityResponse>;
  }

  async report(params: {
    workerId: string;
    entityId: string;
    signal: string;
    artifacts?: Record<string, unknown>;
  }): Promise<ReportResponse> {
    // flow.report blocks — no timeout applied
    const res = await fetch(`${this.url}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: "flow.report", params }),
      signal: undefined, // never abort
    });
    if (!res.ok) throw new Error(`flow.report failed: ${res.status}`);
    return res.json() as Promise<ReportResponse>;
  }
}
