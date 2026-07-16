import { describe, it, expect } from "vitest";
import type { PendingMutation, WorkoutSessionRecord } from "@kinora/contracts";
import { applyPendingMutation } from "../apply-mutation";

/**
 * Pure reducer applying ONE `PendingMutation` on top of a
 * `WorkoutSessionRecord` (Phase 4 web offline). Used for BOTH:
 *  - optimistic local apply when a set/complete is queued
 *  - replaying still-queued mutations on top of a cached snapshot during
 *    offline reload hydration
 */

const session: WorkoutSessionRecord = {
  id: "session-1",
  workoutPlanId: "plan-1",
  status: "active",
  startedAt: "2026-07-06T09:00:00.000Z",
  exercises: [
    {
      id: "exercise-1",
      workoutSessionId: "session-1",
      exerciseIndex: 0,
      title: "Barbell Squat",
      restSeconds: 120,
      setRecords: [
        {
          id: "set-1",
          sessionExerciseId: "exercise-1",
          setIndex: 0,
          targetReps: "8",
          completed: false,
        },
      ],
    },
  ],
};

describe("applyPendingMutation", () => {
  it("applies a 'set' mutation's input onto the matching setRecord, leaving other sets untouched", () => {
    const mutation: PendingMutation = {
      kind: "set",
      sessionId: "session-1",
      setId: "set-1",
      input: { actualReps: 8, weightKg: 60, rpe: 8, completed: true, notes: "Strong" },
      queuedAt: 1,
      clientSeq: 1,
    };

    const result = applyPendingMutation(session, mutation);

    expect(result.exercises[0]?.setRecords[0]).toMatchObject({
      id: "set-1",
      actualReps: 8,
      weightKg: 60,
      rpe: 8,
      completed: true,
      notes: "Strong",
    });
    // Original session is not mutated in place.
    expect(session.exercises[0]?.setRecords[0]?.completed).toBe(false);
  });

  it("applies a 'complete' mutation by flipping session.status to completed", () => {
    const mutation: PendingMutation = {
      kind: "complete",
      sessionId: "session-1",
      queuedAt: 1,
      clientSeq: 1,
    };

    const result = applyPendingMutation(session, mutation);

    expect(result.status).toBe("completed");
  });

  it("is a no-op when the 'set' mutation targets a setId not present in the session", () => {
    const mutation: PendingMutation = {
      kind: "set",
      sessionId: "session-1",
      setId: "set-does-not-exist",
      input: { completed: true },
      queuedAt: 1,
      clientSeq: 1,
    };

    const result = applyPendingMutation(session, mutation);

    expect(result).toEqual(session);
  });
});
