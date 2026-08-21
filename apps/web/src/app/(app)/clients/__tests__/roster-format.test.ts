import { describe, expect, it } from "vitest";
import type { ClientSummaryDTO } from "@kinora/contracts";
import {
  adherenceLabel,
  displayName,
  formatShortDate,
  initialsOf,
  localPart,
  matchesFilter,
  matchesSearch,
  recencyLabel,
  sessionRecency,
  type Translator,
} from "../roster-format";

const fakeT: Translator = (key, values) =>
  values ? `${key}:${JSON.stringify(values)}` : key;

function client(overrides: Partial<ClientSummaryDTO> = {}): ClientSummaryDTO {
  return {
    clientUserId: "user_1" as never,
    email: "elena.lopez@correo.com",
    status: "active",
    ...overrides,
  };
}

describe("localPart", () => {
  it("returns the part before @", () => {
    expect(localPart("elena.lopez@correo.com")).toBe("elena.lopez");
  });

  it("falls back to the whole string when there is no @", () => {
    expect(localPart("not-an-email")).toBe("not-an-email");
  });
});

describe("displayName", () => {
  it("uses the DTO name when present", () => {
    expect(displayName({ name: "Elena López", email: "elena.lopez@correo.com" })).toBe("Elena López");
  });

  it("falls back to the email local-part when name is null", () => {
    expect(displayName({ name: null, email: "elena.lopez@correo.com" })).toBe("elena.lopez");
  });

  it("falls back to the email local-part when name is undefined", () => {
    expect(displayName({ email: "elena.lopez@correo.com" })).toBe("elena.lopez");
  });
});

describe("initialsOf", () => {
  it("derives initials from the name when present", () => {
    expect(initialsOf({ name: "Elena López", email: "x@test.com" })).toBe("EL");
  });

  it("derives initials from the email when no name", () => {
    expect(initialsOf({ name: null, email: "ruben@test.com" })).toBe("RU");
  });

  it("falls back to email when name is blank", () => {
    expect(initialsOf({ name: "   ", email: "sara@test.com" })).toBe("SA");
  });
});

describe("sessionRecency", () => {
  const now = new Date("2026-08-18T12:00:00Z");

  it("is 'none' for null", () => {
    expect(sessionRecency(null, now)).toEqual({ kind: "none" });
  });

  it("is 'none' for undefined", () => {
    expect(sessionRecency(undefined, now)).toEqual({ kind: "none" });
  });

  it("is 'none' for an unparsable date", () => {
    expect(sessionRecency("not-a-date", now)).toEqual({ kind: "none" });
  });

  it("is 'today' for a same-day timestamp", () => {
    expect(sessionRecency("2026-08-18T08:00:00Z", now)).toEqual({ kind: "today" });
  });

  it("is 'yesterday' for exactly one day ago", () => {
    expect(sessionRecency("2026-08-17T08:00:00Z", now)).toEqual({ kind: "yesterday" });
  });

  it("is 'daysAgo' with the day count for older sessions", () => {
    expect(sessionRecency("2026-08-09T08:00:00Z", now)).toEqual({ kind: "daysAgo", days: 9 });
  });

  it("is 'today' for a future timestamp (clock skew), never a negative day count", () => {
    const future = new Date(now.getTime() + 60 * 60 * 1000); // now + 1 hour
    expect(sessionRecency(future.toISOString(), now)).toEqual({ kind: "today" });
  });
});

describe("formatShortDate", () => {
  it("formats a full ISO timestamp as a locale-aware short date, never the raw ISO string", () => {
    expect(formatShortDate("2026-06-29T00:00:00.000Z", "en")).toBe("Jun 29, 2026");
  });

  it("formats a date-only string identically (no UTC day shift)", () => {
    expect(formatShortDate("2026-08-17", "en")).toBe("Aug 17, 2026");
  });

  it("uses Spanish month names for the es locale", () => {
    expect(formatShortDate("2026-06-29T00:00:00.000Z", "es")).toContain("jun");
  });

  it("falls back to the raw value for an unparsable date", () => {
    expect(formatShortDate("not-a-date", "en")).toBe("not-a-date");
  });
});

describe("matchesSearch", () => {
  it("matches on name", () => {
    expect(matchesSearch(client({ name: "Elena López" }), "elena")).toBe(true);
  });

  it("matches on full email", () => {
    expect(matchesSearch(client(), "correo.com")).toBe(true);
  });

  it("matches on the email local-part", () => {
    expect(matchesSearch(client(), "lopez")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesSearch(client({ name: "Elena López" }), "LOPEZ")).toBe(true);
  });

  it("is false for no match", () => {
    expect(matchesSearch(client(), "pablo")).toBe(false);
  });

  it("is true for a blank term (everyone matches)", () => {
    expect(matchesSearch(client(), "   ")).toBe(true);
  });
});

describe("matchesFilter", () => {
  it("'all' matches every status", () => {
    expect(matchesFilter(client({ status: "invited" }), "all")).toBe(true);
  });

  it("'active' matches only active", () => {
    expect(matchesFilter(client({ status: "active" }), "active")).toBe(true);
    expect(matchesFilter(client({ status: "invited" }), "active")).toBe(false);
  });

  it("'invited' matches only invited", () => {
    expect(matchesFilter(client({ status: "invited" }), "invited")).toBe(true);
    expect(matchesFilter(client({ status: "active" }), "invited")).toBe(false);
  });
});

describe("recencyLabel", () => {
  it("maps 'none' to the recency.none key", () => {
    expect(recencyLabel({ kind: "none" }, fakeT)).toBe("clients.roster.recency.none");
  });

  it("maps 'today' to the recency.today key", () => {
    expect(recencyLabel({ kind: "today" }, fakeT)).toBe("clients.roster.recency.today");
  });

  it("maps 'yesterday' to the recency.yesterday key", () => {
    expect(recencyLabel({ kind: "yesterday" }, fakeT)).toBe("clients.roster.recency.yesterday");
  });

  it("maps 'daysAgo' to the recency.daysAgo key with the day count", () => {
    expect(recencyLabel({ kind: "daysAgo", days: 9 }, fakeT)).toBe(
      'clients.roster.recency.daysAgo:{"days":9}',
    );
  });
});

describe("adherenceLabel", () => {
  it("renders a dash for null (no completed sessions)", () => {
    expect(adherenceLabel(null, fakeT)).toBe("—");
  });

  it("renders a dash for undefined (not populated)", () => {
    expect(adherenceLabel(undefined, fakeT)).toBe("—");
  });

  it("renders the translated percentage otherwise", () => {
    expect(adherenceLabel(92, fakeT)).toBe('clients.roster.adherence:{"percent":92}');
  });

  it("never fabricates a value for 0 (an honest zero still renders)", () => {
    expect(adherenceLabel(0, fakeT)).toBe('clients.roster.adherence:{"percent":0}');
  });
});
