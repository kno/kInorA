import { afterEach, describe, expect, it, vi } from "vitest";
import { formatToday, todayIndex, weekdayLabel } from "../week-dates";

/**
 * These helpers are the app's only source of "what day is it". #411 shipped a
 * hardcoded date pill to production, so every assertion here pins the clock and
 * checks the output FOLLOWS it — a helper that ignored `now` would pass a
 * single-date test and fail these.
 */
afterEach(() => {
  vi.useRealTimers();
});

describe("todayIndex", () => {
  it("maps Monday to 0", () => {
    // 2026-08-10 is a Monday.
    expect(todayIndex(new Date("2026-08-10T12:00:00Z"))).toBe(0);
  });

  it("maps Sunday to 6 (Monday-first, not the JS Sunday-first default)", () => {
    // 2026-08-09 is a Sunday — getUTCDay() would say 0.
    expect(todayIndex(new Date("2026-08-09T12:00:00Z"))).toBe(6);
  });

  it("reads the real clock when no date is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T09:30:00Z")); // Wednesday
    expect(todayIndex()).toBe(2);
  });
});

describe("weekdayLabel", () => {
  it("labels each index from the week containing the given date", () => {
    const sunday = new Date("2026-08-09T12:00:00Z");
    expect(weekdayLabel(0, "en", sunday)).toBe("Mon");
    expect(weekdayLabel(6, "en", sunday)).toBe("Sun");
  });

  it("localizes the label", () => {
    const sunday = new Date("2026-08-09T12:00:00Z");
    expect(weekdayLabel(0, "es", sunday)).toBe("lun");
  });
});

describe("formatToday", () => {
  it("follows a frozen clock (EN)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00Z"));
    expect(formatToday("en")).toBe("Sunday, August 9");
  });

  it("follows the clock to a DIFFERENT day (triangulation — a hardcoded string fails here)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-25T10:00:00Z"));
    expect(formatToday("en")).toBe("Friday, December 25");
  });

  it("localizes to Spanish", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00Z"));
    expect(formatToday("es")).toBe("domingo, 9 de agosto");
  });

  it("resolves in UTC, matching the Monday-first week model", () => {
    // 23:30 UTC on the 9th is already the 10th in +02:00. The week board keys
    // off UTC, so the pill must too, or the two disagree about the day.
    expect(formatToday("en", new Date("2026-08-09T23:30:00Z"))).toBe("Sunday, August 9");
  });
});
