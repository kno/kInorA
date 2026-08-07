/**
 * id-only descriptors for `WorkoutTrackerScreen` — no `defaultMessage`,
 * since the `@kinora/i18n` catalog is the single source of truth for copy.
 * Names mirror the pre-refactor `t` object (see `copy/__tests__/
 * tracker-migration.test.ts`).
 */

import { defineMessages } from "react-intl";

export const messages = defineMessages({
  sessionActiveEyebrow: { id: "tracker.live.eyebrow" },
  elapsedLabel: { id: "tracker.timerLabel" },
  pauseLabel: { id: "tracker.pauseLabel" },
  resumeLabel: { id: "tracker.resumeLabel" },
  progressLabel: { id: "tracker.progress.label" },
  progressA11y: { id: "mobileTracker.progress.a11y" },
  progressValueText: { id: "tracker.progress.valuetext" },
  currentExerciseEyebrow: { id: "tracker.currentExercise" },
  setInfo: { id: "mobileTracker.set.info" },
  objectiveLabel: { id: "mobileTracker.objective.withWeight" },
  objectiveLabelNoWeight: { id: "mobileTracker.objective.noWeight" },
  loadLabel: { id: "tracker.load.label" },
  loadUnit: { id: "tracker.unit.kg" },
  repsLabel: { id: "tracker.reps.label" },
  repsUnit: { id: "tracker.unit.reps" },
  decreaseLoad: { id: "tracker.weight.downLabel" },
  increaseLoad: { id: "tracker.weight.upLabel" },
  // Selectable load step size (0.5/1/2.5/5 kg) — reuses the SAME shared
  // `tracker.load.*` catalog keys web's ExerciseCard surfaces (#253). Mobile
  // renders these as a segmented control below the steppers.
  loadStepLabel: { id: "tracker.load.stepLabel" },
  loadStepGroupLabel: { id: "tracker.load.stepGroupLabel" },
  loadStepOptionA11y: { id: "tracker.load.stepOptionA11y" },
  decreaseReps: { id: "mobileTracker.reps.decrease" },
  increaseReps: { id: "mobileTracker.reps.increase" },
  // 14b-v1.1 Slice B: optional 0-10 RPE capture, mobile parity with web's
  // `ExerciseCard`. `rpeLabel` reuses the shared `tracker.rpe` catalog key
  // ("RPE") web already surfaces; `rpeInputA11y` is mobile-only (the
  // accessible label for the numeric text input).
  rpeLabel: { id: "tracker.rpe" },
  rpeInputA11y: { id: "mobileTracker.rpe.a11y" },
  completeSet: { id: "tracker.completeSet.cta" },
  completeSetA11y: { id: "mobileTracker.completeSet.a11y" },
  restActive: { id: "tracker.rest.active" },
  restLabelSm: { id: "tracker.rest.label" },
  addTime: { id: "tracker.rest.addTime" },
  addTimeA11y: { id: "tracker.rest.addLabel" },
  skip: { id: "tracker.rest.skip" },
  skipRest: { id: "tracker.rest.skipLabel" },
  restA11y: { id: "tracker.rest.aria" },
  nextEyebrow: { id: "tracker.next.heading" },
  nextDetail: { id: "mobileTracker.next.detail" },
  nextDetailNoWeight: { id: "mobileTracker.next.detailNoWeight" },
  finishSession: { id: "mobileTracker.finish.cta" },
  finishSessionA11y: { id: "mobileTracker.finish.a11y" },
  loading: { id: "mobileTracker.loading" },
  sessionCompleteTitle: { id: "mobileTracker.complete.title" },
  sessionCompleteBody: { id: "mobileTracker.complete.body" },
  backHome: { id: "mobileTracker.backHome" },
  conflictWithScope: { id: "mobileTracker.conflict.withScope" },
  conflictWithPlan: { id: "mobileTracker.conflict.withPlan" },
  conflictGeneric: { id: "mobileTracker.conflict.generic" },
  // 17b scope A — Resume/Discard actions on the conflict state.
  conflictResume: { id: "mobileTracker.conflict.resume" },
  conflictDiscard: { id: "mobileTracker.conflict.discard" },
  conflictDiscardConfirm: { id: "mobileTracker.conflict.discardConfirm" },
  conflictDiscardConfirmYes: { id: "mobileTracker.conflict.discardConfirmYes" },
  conflictDiscardCancel: { id: "mobileTracker.conflict.discardCancel" },
  conflictDiscardFailed: { id: "mobileTracker.conflict.discardFailed" },
  errorStart: { id: "mobileTracker.error.start" },
  errorLoad: { id: "mobileTracker.error.load" },
  errorRecord: { id: "mobileTracker.error.record" },
  errorComplete: { id: "mobileTracker.error.complete" },
  retry: { id: "mobileTracker.retry" },
  // Phase 5 mobile offline (09b-v1) — reuses the SAME shared `tracker.sync.*`
  // catalog keys web's PlanTrackerClient/PlanStatusClient already surface
  // (EN/ES parity guaranteed by the shared @kinora/i18n catalog). Mobile uses
  // `reload_required` for a local snapshot write failure: the
  // queued mutation is safe, but the current screen should be reloaded from
  // durable state before the user continues.
  syncAuthRequired: { id: "tracker.sync.auth_required" },
  syncReloadRequired: { id: "tracker.sync.reload_required" },
  syncDropped: { id: "tracker.sync.dropped" },
});
