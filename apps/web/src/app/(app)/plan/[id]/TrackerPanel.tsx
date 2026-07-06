import type { WorkoutSessionRecord } from "@kinora/contracts";
import type { WorkoutSetUpdateInput } from "./tracker-types";

interface TrackerPanelProps {
  session: WorkoutSessionRecord;
  messages?: Record<string, string>;
  onRecordSet: (setId: string, input: WorkoutSetUpdateInput) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
}

function parseOptionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string") return undefined;
  if (value.trim() === "") return undefined;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseOptionalText(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getActiveExercise(session: WorkoutSessionRecord) {
  return (
    session.exercises.find((exercise) =>
      exercise.setRecords.some((setRecord) => !setRecord.completed),
    ) ?? session.exercises[0]
  );
}

function getNextAction(session: WorkoutSessionRecord, messages?: Record<string, string>) {
  const t = (key: string, fallback: string) => messages?.[key] ?? fallback;

  if (session.status === "completed") {
    return t("tracker_next_action_done", "Workout completed");
  }

  const pendingSet = session.exercises
    .flatMap((exercise) => exercise.setRecords)
    .find((setRecord) => !setRecord.completed);

  if (!pendingSet) {
    return t("tracker_next_action_finish", "Complete your workout when you're ready.");
  }

  return t("tracker_next_action_log", "Log the next set to keep the workout moving.");
}

export function TrackerPanel({
  session,
  messages,
  onRecordSet,
  onCompleteSession,
}: TrackerPanelProps) {
  const t = (key: string, fallback: string) => messages?.[key] ?? fallback;
  const activeExercise = getActiveExercise(session);
  const nextAction = getNextAction(session, messages);

  return (
    <main className="kin-page">
      <header className="kin-card kin-card--header">
        <div>
          <p className="kin-muted">{t("tracker_live_eyebrow", "Live tracker")}</p>
          <h1 className="kin-title">{t("tracker_live_title", "Live workout")}</h1>
        </div>
        <span className="kin-badge">
          {session.status === "completed"
            ? t("tracker_status_completed", "Completed")
            : t("tracker_status_active", "Active")}
        </span>
      </header>

      {activeExercise && (
        <section className="kin-card">
          <p className="kin-muted">{t("tracker_current_exercise", "Current exercise")}</p>
          <h2 className="kin-subtitle">{activeExercise.title}</h2>
          <p className="kin-text kin-muted">
            {t("tracker_rest_context", "Rest")}: {activeExercise.restSeconds}s
          </p>
          {activeExercise.notes && <p className="kin-text">{activeExercise.notes}</p>}
          <p className="kin-text">
            <strong>{t("tracker_next_action", "Next action")}: </strong>
            {nextAction}
          </p>
        </section>
      )}

      {session.exercises.map((exercise) => (
        <section key={exercise.id} className="kin-card">
          <h3 className="kin-subtitle">{exercise.title}</h3>
          {exercise.notes && <p className="kin-text kin-muted">{exercise.notes}</p>}

          {exercise.setRecords.map((setRecord) => (
            <form
              key={setRecord.id}
              className="kin-card"
              onSubmit={async (event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                await onRecordSet(setRecord.id, {
                  actualReps: parseOptionalNumber(formData.get("actualReps")),
                  weightKg: parseOptionalNumber(formData.get("weightKg")),
                  rpe: parseOptionalNumber(formData.get("rpe")),
                  completed: formData.get("completed") === "on",
                  notes: parseOptionalText(formData.get("notes")),
                });
              }}
            >
              <h4 className="kin-subtitle">
                {t("tracker_set_heading", "Set")} {setRecord.setIndex + 1}
              </h4>
              <p className="kin-text kin-muted">
                {t("tracker_target_reps", "Target reps")}: {setRecord.targetReps}
              </p>

              <label>
                {t("tracker_actual_reps", "Actual reps")}
                <input
                  name="actualReps"
                  type="number"
                  min={0}
                  defaultValue={setRecord.actualReps ?? ""}
                  disabled={session.status === "completed"}
                />
              </label>

              <label>
                {t("tracker_weight", "Weight (kg)")}
                <input
                  name="weightKg"
                  type="number"
                  min={0}
                  step="0.5"
                  defaultValue={setRecord.weightKg ?? ""}
                  disabled={session.status === "completed"}
                />
              </label>

              <label>
                {t("tracker_rpe", "RPE")}
                <input
                  name="rpe"
                  type="number"
                  min={0}
                  max={10}
                  step="1"
                  defaultValue={setRecord.rpe ?? ""}
                  disabled={session.status === "completed"}
                />
              </label>

              <label>
                {t("tracker_notes", "Notes")}
                <input
                  name="notes"
                  type="text"
                  defaultValue={setRecord.notes ?? ""}
                  disabled={session.status === "completed"}
                />
              </label>

              <label>
                <input
                  name="completed"
                  type="checkbox"
                  defaultChecked={setRecord.completed}
                  disabled={session.status === "completed"}
                />
                {t("tracker_completed_toggle", "Completed")}
              </label>

              <button
                type="submit"
                className="kin-btn kin-btn--primary"
                disabled={session.status === "completed"}
              >
                {t("tracker_save_set_cta", "Save set")}
              </button>
            </form>
          ))}
        </section>
      ))}

      <section className="kin-card kin-card--header">
        <button
          type="button"
          className="kin-btn kin-btn--primary"
          disabled={session.status === "completed"}
          onClick={() => onCompleteSession(session.id)}
        >
          {t("tracker_complete_cta", "Complete workout")}
        </button>
      </section>
    </main>
  );
}
