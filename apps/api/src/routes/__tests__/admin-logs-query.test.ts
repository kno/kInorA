import { describe, it, expect } from "vitest";
import { planObservabilityLogQuery } from "../admin-logs.js";

describe("planObservabilityLogQuery", () => {
  it("defaults limit to 50 and leaves all filters unset for an empty query", () => {
    const plan = planObservabilityLogQuery({});
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.filters).toEqual({ limit: 50 });
  });

  it("accepts a full valid filter set and coerces dates", () => {
    const plan = planObservabilityLogQuery({
      tenantId: "aaaaaaaa-0000-0000-0000-000000000001",
      level: "warn",
      event: "billing.webhook",
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-02T00:00:00.000Z",
      limit: "25",
      cursor: "opaque-cursor",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.filters.tenantId).toBe("aaaaaaaa-0000-0000-0000-000000000001");
    expect(plan.filters.level).toBe("warn");
    expect(plan.filters.event).toBe("billing.webhook");
    expect(plan.filters.from?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(plan.filters.to?.toISOString()).toBe("2026-08-02T00:00:00.000Z");
    expect(plan.filters.limit).toBe(25);
    expect(plan.filters.cursor).toBe("opaque-cursor");
  });

  it("rejects an out-of-enum level", () => {
    expect(planObservabilityLogQuery({ level: "debug" }).ok).toBe(false);
  });

  it("rejects a malformed tenantId", () => {
    expect(planObservabilityLogQuery({ tenantId: "not-a-uuid" }).ok).toBe(false);
  });

  it("rejects a non-integer or out-of-range limit", () => {
    expect(planObservabilityLogQuery({ limit: "0" }).ok).toBe(false);
    expect(planObservabilityLogQuery({ limit: "101" }).ok).toBe(false);
    expect(planObservabilityLogQuery({ limit: "abc" }).ok).toBe(false);
    expect(planObservabilityLogQuery({ limit: "10.5" }).ok).toBe(false);
  });

  it("caps limit at 100 (100 is allowed, 101 is not)", () => {
    const ok = planObservabilityLogQuery({ limit: "100" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.filters.limit).toBe(100);
  });

  it("rejects an unparseable ISO date", () => {
    expect(planObservabilityLogQuery({ from: "yesterday" }).ok).toBe(false);
    expect(planObservabilityLogQuery({ to: "2026-13-45" }).ok).toBe(false);
  });

  it("rejects a from later than to", () => {
    expect(
      planObservabilityLogQuery({
        from: "2026-08-02T00:00:00.000Z",
        to: "2026-08-01T00:00:00.000Z",
      }).ok,
    ).toBe(false);
  });

  it("rejects a blank or overly long event", () => {
    expect(planObservabilityLogQuery({ event: "   " }).ok).toBe(false);
    expect(planObservabilityLogQuery({ event: "x".repeat(201) }).ok).toBe(false);
  });
});
