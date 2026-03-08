import { describe, expect, it } from "vitest";
import { Pool } from "../src/pool/pool.js";

describe("Pool concurrency tracking", () => {
  it("allocates a slot with flow and repo metadata", () => {
    const pool = new Pool(4);
    const slot = pool.allocate("s1", "w1", "e1", "do stuff", "wopr-changeset", "wopr-network/wopr");
    expect(slot).not.toBeNull();
    expect(slot!.flowName).toBe("wopr-changeset");
    expect(slot!.repo).toBe("wopr-network/wopr");
  });

  it("activeCountByFlow returns count of active slots for a flow", () => {
    const pool = new Pool(4);
    pool.allocate("s1", "w1", "e1", "p1", "wopr-changeset", "wopr-network/wopr");
    pool.allocate("s2", "w2", "e2", "p2", "wopr-changeset", "wopr-network/defcon");
    pool.allocate("s3", "w3", "e3", "p3", "other-flow", "wopr-network/wopr");
    expect(pool.activeCountByFlow("wopr-changeset")).toBe(2);
    expect(pool.activeCountByFlow("other-flow")).toBe(1);
    expect(pool.activeCountByFlow("nonexistent")).toBe(0);
  });

  it("activeCountByRepo returns count of active slots for a flow+repo combo", () => {
    const pool = new Pool(4);
    pool.allocate("s1", "w1", "e1", "p1", "wopr-changeset", "wopr-network/wopr");
    pool.allocate("s2", "w2", "e2", "p2", "wopr-changeset", "wopr-network/wopr");
    pool.allocate("s3", "w3", "e3", "p3", "wopr-changeset", "wopr-network/defcon");
    expect(pool.activeCountByRepo("wopr-changeset", "wopr-network/wopr")).toBe(2);
    expect(pool.activeCountByRepo("wopr-changeset", "wopr-network/defcon")).toBe(1);
    expect(pool.activeCountByRepo("wopr-changeset", "wopr-network/radar")).toBe(0);
  });

  it("counts decrease after release", () => {
    const pool = new Pool(4);
    pool.allocate("s1", "w1", "e1", "p1", "wopr-changeset", "wopr-network/wopr");
    pool.allocate("s2", "w2", "e2", "p2", "wopr-changeset", "wopr-network/wopr");
    pool.release("s1");
    expect(pool.activeCountByFlow("wopr-changeset")).toBe(1);
    expect(pool.activeCountByRepo("wopr-changeset", "wopr-network/wopr")).toBe(1);
  });

  it("allocate still works with null flow/repo (backward compat)", () => {
    const pool = new Pool(4);
    const slot = pool.allocate("s1", "w1", "e1", "p1");
    expect(slot).not.toBeNull();
    expect(slot!.flowName).toBeNull();
    expect(slot!.repo).toBeNull();
    expect(pool.activeCountByFlow("anything")).toBe(0);
  });
});
