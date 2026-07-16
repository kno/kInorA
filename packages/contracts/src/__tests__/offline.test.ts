import { describe, it, expectTypeOf } from "vitest";
import type {
  ConnectivityMonitor,
  FlushErrorCode,
  PendingMutation,
  WorkoutHistoryEntry,
  WorkoutHistoryQuery,
  WorkoutSessionRecord,
  WorkoutSessionSnapshot,
  WorkoutSetUpdateInput,
} from "../index";

describe("offline contract types (09b-v1-workout-offline-history)", () => {
  it("PendingMutation discriminates 'set' vs 'complete', clientSeq is the LWW/order key", () => {
    const setMutation: PendingMutation = {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { completed: true },
      queuedAt: 1,
      clientSeq: 1,
    };
    const completeMutation: PendingMutation = {
      kind: "complete",
      sessionId: "session-1",
      queuedAt: 2,
      clientSeq: 2,
    };

    expectTypeOf(setMutation.kind).toEqualTypeOf<"set">();
    expectTypeOf(setMutation.input).toEqualTypeOf<WorkoutSetUpdateInput>();
    expectTypeOf(completeMutation.kind).toEqualTypeOf<"complete">();

    if (setMutation.kind === "set") {
      expectTypeOf(setMutation.setId).toEqualTypeOf<string>();
    }
    if (completeMutation.kind === "complete") {
      // `complete` never carries a `setId` or `input`.
      expectTypeOf(completeMutation).not.toHaveProperty("setId");
    }
  });

  it("WorkoutSetUpdateInput matches the app-local shape (single source of truth)", () => {
    expectTypeOf<WorkoutSetUpdateInput>().toEqualTypeOf<{
      actualReps?: number;
      weightKg?: number;
      rpe?: number;
      completed: boolean;
      notes?: string;
    }>();
  });

  it("ConnectivityMonitor exposes isOnline() and subscribe(cb) returning an unsubscribe fn", () => {
    const monitor: ConnectivityMonitor = {
      isOnline: () => true,
      subscribe: (cb) => {
        cb(true);
        return () => {};
      },
    };
    expectTypeOf(monitor.isOnline()).toEqualTypeOf<boolean>();
    expectTypeOf(monitor.subscribe).returns.toEqualTypeOf<() => void>();
  });

  it("WorkoutHistoryEntry carries session + totalVolume + optional averageRpe/trend", () => {
    expectTypeOf<WorkoutHistoryEntry>().toEqualTypeOf<{
      session: WorkoutSessionRecord;
      totalVolume: number;
      averageRpe?: number;
      trend?: { volumeDelta: number; direction: "up" | "down" | "flat" };
    }>();
  });

  it("WorkoutHistoryQuery is an offset-based pagination DTO, both fields optional", () => {
    expectTypeOf<WorkoutHistoryQuery>().toEqualTypeOf<{
      limit?: number;
      offset?: number;
    }>();

    const empty: WorkoutHistoryQuery = {};
    const withPaging: WorkoutHistoryQuery = { limit: 20, offset: 0 };
    expectTypeOf(empty).toEqualTypeOf<WorkoutHistoryQuery>();
    expectTypeOf(withPaging).toEqualTypeOf<WorkoutHistoryQuery>();
  });

  it("WorkoutSessionSnapshot caches a session record with a cachedAt timestamp", () => {
    expectTypeOf<WorkoutSessionSnapshot>().toEqualTypeOf<{
      sessionId: string;
      session: WorkoutSessionRecord;
      cachedAt: number;
    }>();
  });

  it("FlushErrorCode enumerates the discriminated flush-failure taxonomy", () => {
    expectTypeOf<FlushErrorCode>().toEqualTypeOf<
      "UNREACHABLE" | "STALE_ACTION" | "VALIDATION" | "NOT_FOUND" | "SERVER"
    >();
  });
});
