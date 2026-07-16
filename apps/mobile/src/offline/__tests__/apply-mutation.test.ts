import { describe, expect, it } from "vitest";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import { applyPendingMutation } from "../apply-mutation";

const session: WorkoutSessionRecord = {
  id: "s1",
  workoutPlanId: "p1",
  status: "active",
  startedAt: "2026-07-16T10:00:00.000Z",
  exercises: [
    {
      id: "ex1",
      workoutSessionId: "s1",
      exerciseIndex: 0,
      title: "Sentadilla",
      restSeconds: 90,
      setRecords: [
        { id: "set1", sessionExerciseId: "ex1", setIndex: 0, targetReps: "8", completed: false },
      ],
    },
  ],
};

describe("applyPendingMutation", () => {
  it("applies a set mutation's input onto the matching set record", () => {
    const result = applyPendingMutation(session, {
      kind: "set",
      sessionId: "s1",
      setId: "set1",
      input: { completed: true, actualReps: 8, weightKg: 40 },
      queuedAt: 1000,
      clientSeq: 1,
    });
    expect(result.exercises[0]!.setRecords[0]).toMatchObject({
      completed: true,
      actualReps: 8,
      weightKg: 40,
    });
  });

  it("never mutates the input session", () => {
    const original = JSON.parse(JSON.stringify(session));
    applyPendingMutation(session, {
      kind: "set",
      sessionId: "s1",
      setId: "set1",
      input: { completed: true },
      queuedAt: 1000,
      clientSeq: 1,
    });
    expect(session).toEqual(original);
  });

  it("returns the same session reference when no set matches", () => {
    const result = applyPendingMutation(session, {
      kind: "set",
      sessionId: "s1",
      setId: "does-not-exist",
      input: { completed: true },
      queuedAt: 1000,
      clientSeq: 1,
    });
    expect(result).toBe(session);
  });

  it("flips status to completed for a complete mutation", () => {
    const result = applyPendingMutation(session, {
      kind: "complete",
      sessionId: "s1",
      queuedAt: 1000,
      clientSeq: 1,
    });
    expect(result.status).toBe("completed");
    expect(session.status).toBe("active");
  });
});
