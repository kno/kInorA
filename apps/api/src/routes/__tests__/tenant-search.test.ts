import { describe, it, expect } from "vitest";
import { planTenantSearch } from "../tenant-search.js";

const UUID = "bbbbbbbb-0000-0000-0000-000000000001";

describe("planTenantSearch", () => {
  it("plans a case-insensitive name substring search for a plain term", () => {
    const plan = planTenantSearch("Acme", undefined);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.term).toBe("Acme");
      expect(plan.matchId).toBeNull();
      expect(plan.limit).toBe(20);
    }
  });

  it("adds an exact id match when the query is a valid UUID", () => {
    const plan = planTenantSearch(UUID, undefined);
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.matchId).toBe(UUID);
      // still usable as a name term too
      expect(plan.term).toBe(UUID);
    }
  });

  it("does not set matchId for a non-UUID query", () => {
    const plan = planTenantSearch("not-a-uuid", undefined);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.matchId).toBeNull();
  });

  it("defaults the limit to 20 when absent or invalid", () => {
    expect((planTenantSearch("x", undefined) as { limit: number }).limit).toBe(20);
    expect((planTenantSearch("x", "0") as { limit: number }).limit).toBe(20);
    expect((planTenantSearch("x", "abc") as { limit: number }).limit).toBe(20);
  });

  it("caps the limit at 50", () => {
    expect((planTenantSearch("x", "100") as { limit: number }).limit).toBe(50);
    expect((planTenantSearch("x", "5") as { limit: number }).limit).toBe(5);
    expect((planTenantSearch("x", 30) as { limit: number }).limit).toBe(30);
  });

  it("rejects an empty or whitespace-only query", () => {
    expect(planTenantSearch("", undefined).ok).toBe(false);
    expect(planTenantSearch("   ", undefined).ok).toBe(false);
    expect(planTenantSearch(undefined, undefined).ok).toBe(false);
  });

  it("rejects an over-long query", () => {
    expect(planTenantSearch("a".repeat(101), undefined).ok).toBe(false);
  });

  it("escapes ILIKE wildcard characters in the term", () => {
    const plan = planTenantSearch("50%_off\\", undefined);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.term).toBe("50\\%\\_off\\\\");
  });
});
