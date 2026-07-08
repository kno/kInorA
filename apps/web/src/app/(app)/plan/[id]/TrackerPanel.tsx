"use client";

/**
 * TrackerPanel — live workout tracker container (desktop-tracker Open Design).
 *
 * Renders the mockup's main-panel + performance-rail INSIDE the existing app
 * shell (the shell already supplies the sidebar/navigation, so the mockup's
 * left sidebar is intentionally not recreated here).
 *
 * This is the CONTAINER: it derives a pure view model from the session
 * (`deriveTrackerModel`), owns the client-only timers (session elapsed + rest
 * ring) via hooks, and composes the presentational pieces. All the display
 * logic lives in the small components under `./tracker/`, which keeps this file
 * about wiring, not markup.
 *
 * Real, data-backed pieces: session timer, segmented progress, current-exercise
 * metrics (volume, set n/total, rpe), load/reps steppers, rest ring, next
 * exercise, timeline, and the rail's Volume + Series stats. Explicit STUBS
 * (never faked): streak, avg rest, and the AI microadjust note.
 */

import { useCallback } from "react";
import type { WorkoutSessionRecord } from "@kinora/contracts";
import type { WorkoutSetUpdateInput } from "./tracker-types";
import { deriveTrackerModel } from "./tracker/tracker-model";
import { useSessionTimer } from "./tracker/use-session-timer";
import { useRestTimer } from "./tracker/use-rest-timer";
import { TrackerTopbar } from "./tracker/TrackerTopbar";
import { SessionProgress } from "./tracker/SessionProgress";
import { ExerciseCard } from "./tracker/ExerciseCard";
import { RestRing } from "./tracker/RestRing";
import { NextExercisePreview } from "./tracker/NextExercisePreview";
import { Timeline } from "./tracker/Timeline";
import { PerformanceRail } from "./tracker/PerformanceRail";
import styles from "./TrackerPanel.module.css";

interface TrackerPanelProps {
  session: WorkoutSessionRecord;
  messages?: Record<string, string>;
  onRecordSet: (setId: string, input: WorkoutSetUpdateInput) => Promise<void>;
  onCompleteSession: (sessionId: string) => Promise<void>;
}

export function TrackerPanel({
  session,
  messages,
  onRecordSet,
  onCompleteSession,
}: TrackerPanelProps) {
  const t = useCallback(
    (key: string, fallback: string): string => messages?.[key] ?? fallback,
    [messages],
  );

  const model = deriveTrackerModel(session);
  const restDuration = model.activeExercise?.restSeconds ?? 60;

  const timer = useSessionTimer(session.startedAt, model.isCompleted);
  const rest = useRestTimer(restDuration);

  const handleComplete = useCallback(
    () => onCompleteSession(session.id),
    [onCompleteSession, session.id],
  );

  return (
    <section className={styles.tracker} aria-label={t("tracker_live_title", "Live workout")}>
      <div className={styles.mainPanel}>
        <TrackerTopbar
          t={t}
          title={model.activeExercise?.title ?? t("tracker_live_title", "Live workout")}
          elapsed={timer.elapsed}
          paused={timer.paused}
          isCompleted={model.isCompleted}
          onTogglePause={timer.togglePause}
          onComplete={handleComplete}
        />

        <SessionProgress
          t={t}
          segments={model.segments}
          percent={model.percent}
          completedSets={model.completedSets}
          totalSets={model.totalSets}
          currentExerciseNumber={model.currentExerciseNumber}
          totalExercises={model.totalExercises}
        />

        <div className={styles.workbench}>
          <ExerciseCard
            t={t}
            activeExercise={model.activeExercise}
            activeSet={model.activeSet}
            currentSetNumber={model.currentSetNumber}
            totalSetsInExercise={model.totalSetsInExercise}
            exerciseVolume={model.activeExerciseVolume}
            canRecord={model.canRecord}
            onRecordSet={onRecordSet}
            onSetCompleted={rest.start}
          />

          <div className={styles.sideStack}>
            <RestRing
              t={t}
              duration={restDuration}
              remaining={rest.remaining}
              onSkip={rest.skip}
              onAddTime={rest.addTime}
            />
            <NextExercisePreview t={t} nextExercise={model.nextExercise} />
          </div>
        </div>

        <Timeline t={t} items={model.timeline} />
      </div>

      <PerformanceRail
        t={t}
        sessionVolume={model.sessionVolume}
        completedSets={model.completedSets}
        totalSets={model.totalSets}
      />
    </section>
  );
}
