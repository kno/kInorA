"use client";

/**
 * ProgramEditor — the hand-edit surface for a ready plan's program
 * (17d PR D, `/plan/[id]/edit`).
 *
 * Editing a program is not editing history. `session_exercises` snapshots
 * every exercise at the moment a session starts, so what you trained on
 * Tuesday stays what you trained on Tuesday, and a session in progress right
 * now keeps the workout it was built from. The edit takes effect on the NEXT
 * session started against this plan — which is what the copy tells the user.
 *
 * Two things this component deliberately does NOT do:
 *
 * - It does not own validation. `validateEditedProgram` runs here purely to
 *   spare a round-trip and to name the broken rule while the user is still
 *   looking at it; the server runs the same function and is the source of
 *   truth. A client-only check is not validation.
 * - It does not delete anything. Removing a day or an exercise rewrites the
 *   program document that gets saved; no row is deleted, and no session,
 *   set record, or stat is touched.
 *
 * Concurrency: the editor loads `version` and sends it back as
 * `expectedVersion` (#421 — an integer token; this used to be the `updatedAt`
 * timestamp, which could not do the job correctly). A save that lost the race
 * comes back as a conflict with the current version, and the user is offered a
 * reload rather than being told "saved" over someone else's work.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { WorkoutProgram, WorkoutSession } from "@kinora/contracts";
import { validateEditedProgram, type EditedProgramIssue } from "@kinora/domain/plan";
import styles from "./ProgramEditor.module.css";
import { updatePlanProgramAction } from "./actions";
import type { UpdateProgramResult } from "./program-edit-types";

export interface ProgramEditorProps {
  planId: string;
  planName?: string;
  program: WorkoutProgram;
  /** The version token this editor loaded. Sent back as `expectedVersion`. */
  version: number;
  /** Defaults to the real Server Action. Injectable for tests. */
  onSave?: (
    planId: string,
    program: WorkoutProgram,
    expectedVersion: number,
  ) => Promise<UpdateProgramResult>;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "invalid"; issues: EditedProgramIssue[] }
  | { kind: "conflict" }
  | { kind: "not_ready" }
  | { kind: "error" };

/** A blank exercise row, so "add" never yields a half-typed schema failure. */
function blankExercise() {
  return { name: "", sets: 3, reps: "8-12", restSeconds: 90 };
}

/** The lowest day number in 1..7 not already claimed, or 1 when the week is full. */
function nextFreeDay(sessions: WorkoutSession[]): number {
  const taken = new Set(sessions.map((session) => session.day));
  for (let day = 1; day <= 7; day++) {
    if (!taken.has(day)) return day;
  }
  return 1;
}

export function ProgramEditor({
  planId,
  planName,
  program: initialProgram,
  version: initialVersion,
  onSave = updatePlanProgramAction,
}: ProgramEditorProps) {
  const t = useTranslations();
  const router = useRouter();
  const [program, setProgram] = React.useState<WorkoutProgram>(initialProgram);
  const [expectedVersion, setExpectedVersion] = React.useState(initialVersion);
  const [state, setState] = React.useState<SaveState>({ kind: "idle" });

  function updateSessions(next: WorkoutSession[]) {
    setProgram((prev) => ({ ...prev, weeklySessions: next }));
    setState({ kind: "idle" });
  }

  function patchSession(index: number, patch: Partial<WorkoutSession>) {
    updateSessions(
      program.weeklySessions.map((session, i) =>
        i === index ? { ...session, ...patch } : session,
      ),
    );
  }

  function patchExercise(
    sessionIndex: number,
    exerciseIndex: number,
    patch: Record<string, unknown>,
  ) {
    patchSession(sessionIndex, {
      exercises: program.weeklySessions[sessionIndex]!.exercises.map((exercise, i) =>
        i === exerciseIndex ? { ...exercise, ...patch } : exercise,
      ),
    });
  }

  async function handleSave() {
    // Pre-flight only: the server runs this same function and decides.
    const issues = validateEditedProgram(program);
    if (issues.length > 0) {
      setState({ kind: "invalid", issues });
      return;
    }

    setState({ kind: "saving" });
    const result = await onSave(planId, program, expectedVersion);

    if (result.kind === "ok") {
      setProgram(result.program);
      setExpectedVersion(result.version);
      setState({ kind: "saved" });
      return;
    }
    if (result.kind === "conflict") {
      setState({ kind: "conflict" });
      return;
    }
    if (result.kind === "not_ready") {
      setState({ kind: "not_ready" });
      return;
    }
    if (result.kind === "invalid") {
      setState({ kind: "invalid", issues: result.issues as EditedProgramIssue[] });
      return;
    }
    setState({ kind: "error" });
  }

  return (
    <div data-testid="program-editor">
      <h1 className="kin-title">{planName ?? t("planEdit.title")}</h1>
      <p className="kin-text kin-muted">{t("planEdit.description")}</p>

      {program.weeklySessions.map((session, sessionIndex) => (
        <section
          key={`day-${sessionIndex}`}
          className={styles.day}
          data-testid={`edit-day-${sessionIndex}`}
        >
          <div className={styles.dayHead}>
            <div className="kin-field">
              <label className="kin-label" htmlFor={`day-number-${sessionIndex}`}>
                {t("planEdit.dayNumberLabel")}
              </label>
              <input
                id={`day-number-${sessionIndex}`}
                data-testid={`day-number-${sessionIndex}`}
                className="kin-input"
                type="number"
                min={1}
                max={7}
                value={session.day}
                onChange={(event) =>
                  patchSession(sessionIndex, { day: Number(event.target.value) })
                }
              />
            </div>
            <div className="kin-field">
              <label className="kin-label" htmlFor={`day-title-${sessionIndex}`}>
                {t("planEdit.dayTitleLabel")}
              </label>
              <input
                id={`day-title-${sessionIndex}`}
                data-testid={`day-title-${sessionIndex}`}
                className="kin-input"
                type="text"
                value={session.title}
                onChange={(event) =>
                  patchSession(sessionIndex, { title: event.target.value })
                }
              />
            </div>
            <button
              type="button"
              className="kin-btn kin-btn--ghost"
              data-testid={`remove-day-${sessionIndex}`}
              onClick={() =>
                updateSessions(program.weeklySessions.filter((_, i) => i !== sessionIndex))
              }
            >
              {t("planEdit.removeDay")}
            </button>
          </div>

          {session.exercises.map((exercise, exerciseIndex) => (
            <div
              key={`exercise-${sessionIndex}-${exerciseIndex}`}
              className={styles.exercise}
              data-testid={`edit-exercise-${sessionIndex}-${exerciseIndex}`}
            >
              <div className="kin-field">
                <label
                  className="kin-label"
                  htmlFor={`exercise-name-${sessionIndex}-${exerciseIndex}`}
                >
                  {t("planEdit.exerciseNameLabel")}
                </label>
                <input
                  id={`exercise-name-${sessionIndex}-${exerciseIndex}`}
                  data-testid={`exercise-name-${sessionIndex}-${exerciseIndex}`}
                  className="kin-input"
                  type="text"
                  value={exercise.name}
                  onChange={(event) =>
                    patchExercise(sessionIndex, exerciseIndex, { name: event.target.value })
                  }
                />
              </div>
              <div className="kin-field">
                <label
                  className="kin-label"
                  htmlFor={`exercise-sets-${sessionIndex}-${exerciseIndex}`}
                >
                  {t("planEdit.exerciseSetsLabel")}
                </label>
                <input
                  id={`exercise-sets-${sessionIndex}-${exerciseIndex}`}
                  data-testid={`exercise-sets-${sessionIndex}-${exerciseIndex}`}
                  className="kin-input"
                  type="number"
                  min={1}
                  value={exercise.sets}
                  onChange={(event) =>
                    patchExercise(sessionIndex, exerciseIndex, {
                      sets: Number(event.target.value),
                    })
                  }
                />
              </div>
              <div className="kin-field">
                <label
                  className="kin-label"
                  htmlFor={`exercise-reps-${sessionIndex}-${exerciseIndex}`}
                >
                  {t("planEdit.exerciseRepsLabel")}
                </label>
                <input
                  id={`exercise-reps-${sessionIndex}-${exerciseIndex}`}
                  data-testid={`exercise-reps-${sessionIndex}-${exerciseIndex}`}
                  className="kin-input"
                  type="text"
                  value={exercise.reps}
                  onChange={(event) =>
                    patchExercise(sessionIndex, exerciseIndex, { reps: event.target.value })
                  }
                />
              </div>
              <div className="kin-field">
                <label
                  className="kin-label"
                  htmlFor={`exercise-rest-${sessionIndex}-${exerciseIndex}`}
                >
                  {t("planEdit.exerciseRestLabel")}
                </label>
                <input
                  id={`exercise-rest-${sessionIndex}-${exerciseIndex}`}
                  data-testid={`exercise-rest-${sessionIndex}-${exerciseIndex}`}
                  className="kin-input"
                  type="number"
                  min={0}
                  value={exercise.restSeconds}
                  onChange={(event) =>
                    patchExercise(sessionIndex, exerciseIndex, {
                      restSeconds: Number(event.target.value),
                    })
                  }
                />
              </div>
              <button
                type="button"
                className="kin-btn kin-btn--ghost"
                data-testid={`remove-exercise-${sessionIndex}-${exerciseIndex}`}
                onClick={() =>
                  patchSession(sessionIndex, {
                    exercises: session.exercises.filter((_, i) => i !== exerciseIndex),
                  })
                }
              >
                {t("planEdit.removeExercise")}
              </button>
            </div>
          ))}

          <button
            type="button"
            className="kin-btn kin-btn--ghost"
            data-testid={`add-exercise-${sessionIndex}`}
            onClick={() =>
              patchSession(sessionIndex, {
                exercises: [...session.exercises, blankExercise()],
              })
            }
          >
            {t("planEdit.addExercise")}
          </button>
        </section>
      ))}

      <div className={styles.actions}>
        <button
          type="button"
          className="kin-btn kin-btn--ghost"
          data-testid="add-day"
          onClick={() =>
            updateSessions([
              ...program.weeklySessions,
              {
                day: nextFreeDay(program.weeklySessions),
                title: "",
                exercises: [blankExercise()],
              },
            ])
          }
        >
          {t("planEdit.addDay")}
        </button>
        <button
          type="button"
          className="kin-btn kin-btn--accent"
          data-testid="save-program"
          disabled={state.kind === "saving"}
          onClick={() => void handleSave()}
        >
          {state.kind === "saving" ? t("planEdit.saving") : t("planEdit.save")}
        </button>
      </div>

      {state.kind === "saved" && (
        <p className="kin-text" role="status" data-testid="edit-saved">
          {t("planEdit.saved")}
        </p>
      )}

      {state.kind === "invalid" && (
        <div role="alert" data-testid="edit-validation" className="kin-card kin-card--warning">
          <p className="kin-error">{t("planEdit.validationTitle")}</p>
          <ul>
            {state.issues.map((issue) => (
              <li key={issue} className="kin-text">
                {t(`planEdit.issues.${issue}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A lost race is not a validation failure, and the fix is different:
          reload to the version that won, then re-apply the edit. */}
      {state.kind === "conflict" && (
        <div role="alert" data-testid="edit-conflict" className="kin-card kin-card--warning">
          <p className="kin-error">{t("planEdit.conflict.title")}</p>
          <p className="kin-text">{t("planEdit.conflict.desc")}</p>
          <button
            type="button"
            className="kin-btn kin-btn--accent"
            data-testid="edit-conflict-reload"
            onClick={() => router.refresh()}
          >
            {t("planEdit.conflict.reload")}
          </button>
        </div>
      )}

      {state.kind === "not_ready" && (
        <div role="alert" data-testid="edit-not-ready" className="kin-card kin-card--warning">
          <p className="kin-error">{t("planEdit.notReady.title")}</p>
          <p className="kin-text">{t("planEdit.notReady.desc")}</p>
        </div>
      )}

      {state.kind === "error" && (
        <p className="kin-error" role="alert" data-testid="edit-error">
          {t("planEdit.error")}
        </p>
      )}
    </div>
  );
}

export default ProgramEditor;
