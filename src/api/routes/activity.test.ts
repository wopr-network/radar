import { describe, expect, it, vi } from "vitest";
import type { ActivityRow, IEntityActivityRepo } from "../../db/repos/i-entity-activity-repo.js";
import { Router } from "../router.js";
import { registerActivityRoutes } from "./activity.js";

function makeRow(seq: number): ActivityRow {
  return { id: `id-${seq}`, entityId: "e1", slotId: "s1", seq, type: "text", data: { text: "hi" }, createdAt: 0 };
}

function makeRepo(rows: ActivityRow[]): IEntityActivityRepo {
  return {
    insert: vi.fn(),
    getByEntity: vi.fn().mockReturnValue(rows),
    getSummary: vi.fn().mockReturnValue(""),
    deleteByEntity: vi.fn(),
  };
}

describe("GET /api/entities/:entityId/activity", () => {
  it("returns empty items and nextSeq 0 for unknown entity", async () => {
    const repo = makeRepo([]);
    const router = new Router();
    registerActivityRoutes(router, repo);

    const result = await router.handle("GET", "/api/entities/unknown/activity", "", new URLSearchParams());
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ items: [], nextSeq: 0 });
  });

  it("returns all rows when since omitted", async () => {
    const rows = [makeRow(0), makeRow(1), makeRow(2)];
    const repo = makeRepo(rows);
    const router = new Router();
    registerActivityRoutes(router, repo);

    const result = await router.handle("GET", "/api/entities/e1/activity", "", new URLSearchParams());
    expect(result.status).toBe(200);
    const body = result.body as { items: ActivityRow[]; nextSeq: number };
    expect(body.items).toHaveLength(3);
    expect(repo.getByEntity).toHaveBeenCalledWith("e1", undefined);
  });

  it("passes since to getByEntity and returns only later rows", async () => {
    const rows = [makeRow(3), makeRow(4)];
    const repo = makeRepo(rows);
    const router = new Router();
    registerActivityRoutes(router, repo);

    const result = await router.handle("GET", "/api/entities/e1/activity", "", new URLSearchParams("since=2"));
    expect(result.status).toBe(200);
    const body = result.body as { items: ActivityRow[]; nextSeq: number };
    expect(body.items).toHaveLength(2);
    expect(repo.getByEntity).toHaveBeenCalledWith("e1", 2);
  });

  it("sets nextSeq to last row seq + 1", async () => {
    const rows = [makeRow(5), makeRow(7)];
    const repo = makeRepo(rows);
    const router = new Router();
    registerActivityRoutes(router, repo);

    const result = await router.handle("GET", "/api/entities/e1/activity", "", new URLSearchParams());
    const body = result.body as { items: ActivityRow[]; nextSeq: number };
    expect(body.nextSeq).toBe(8);
  });
});
