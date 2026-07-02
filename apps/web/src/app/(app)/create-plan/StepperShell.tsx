"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  PlanGoal,
  PlanLimitation,
  PlanSpec,
  TrainingLocation,
} from "@kinora/contracts";
import { OrbitProgress } from "@/components/orbit";
import { GoalStep } from "@/components/wizard/GoalStep";
import { LocationStep } from "@/components/wizard/LocationStep";
import { FrequencyStep } from "@/components/wizard/FrequencyStep";
import { DurationStep } from "@/components/wizard/DurationStep";
import { EquipmentStep } from "@/components/wizard/EquipmentStep";
import { LimitationsStep } from "@/components/wizard/LimitationsStep";
import styles from "./stepper-shell.module.css";

const TOTAL_STEPS = 6;

export interface InitialDraft {
  step: number;
  spec: Partial<PlanSpec>;
}

export interface StepperShellProps {
  /** Hydrated server draft (resume). Absent → fresh wizard at step 1. */
  initialDraft?: InitialDraft;
  /** Persists the current step + spec to the server (POST /plan-specs/drafts). */
  saveDraftAction: (step: number, spec: Partial<PlanSpec>) => Promise<void>;
  /**
   * Promotes the draft to a confirmed PlanSpec and triggers AI generation.
   * Returns { planId, status } so the shell can navigate to /plan/[planId].
   */
  confirmPlanSpecAction: () => Promise<{ planId: string; status: string }>;
  /** Resolved i18n catalogue passed down from the server page. */
  messages?: Record<string, string>;
}

/** Catalog keys + English fallbacks for the six step titles. */
const STEP_QUESTIONS: readonly { key: string; fallback: string }[] = [
  { key: "wizard_step_goal_title", fallback: "What is your main goal?" },
  { key: "wizard_step_location_title", fallback: "Where will you train?" },
  { key: "wizard_step_equipment_title", fallback: "What equipment do you have?" },
  { key: "wizard_step_frequency_title", fallback: "How many days per week?" },
  { key: "wizard_step_duration_title", fallback: "How long is each session?" },
  {
    key: "wizard_step_limitations_title",
    fallback: "Any limitations to keep in mind?",
  },
] as const;

/**
 * Create-plan stepper shell.
 *
 * Holds `{ step, spec }`, renders one step at a time, and drives the Orbit
 * progress ring (`value = step - 1`, `max = TOTAL_STEPS - 1`, readout "N / 6").
 * Continue persists the draft server-side; Back is local and preserves prior
 * values; Finish (enabled only when every required input is present) promotes
 * the draft to a confirmed PlanSpec. No workout program is produced here.
 */
export function StepperShell({
  initialDraft,
  saveDraftAction,
  confirmPlanSpecAction,
  messages = {},
}: StepperShellProps) {
  const t = (key: string, fallback: string): string => messages[key] ?? fallback;
  const router = useRouter();
  const [step, setStep] = useState(initialDraft?.step ?? 1);
  const [spec, setSpec] = useState<Partial<PlanSpec>>(initialDraft?.spec ?? {});
  const [resumed, setResumed] = useState(Boolean(initialDraft));
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<PlanSpec>) => {
    setSpec((prev) => ({ ...prev, ...patch }));
  };

  const isCurrentStepComplete = (): boolean => {
    switch (step) {
      case 1:
        return spec.goal != null;
      case 2:
        return spec.location != null;
      case 3:
        return spec.equipment != null; // empty array is valid once visited
      case 4:
        return spec.daysPerWeek != null;
      case 5:
        return spec.sessionDurationMinutes != null;
      case 6:
        return spec.limitations != null; // empty array is valid once visited
      default:
        return false;
    }
  };

  const isSpecComplete = (): boolean =>
    spec.goal != null &&
    spec.location != null &&
    spec.daysPerWeek != null &&
    spec.sessionDurationMinutes != null &&
    spec.equipment != null &&
    spec.limitations != null;

  /**
   * Persists the given spec for the next step and advances. Shared by the
   * Continue button and by single-choice auto-advance so both paths behave
   * identically. Accepts an explicit spec because auto-advance fires from the
   * same event that sets the selection, before `spec` state has re-rendered.
   */
  const advance = async (currentSpec: Partial<PlanSpec>) => {
    const nextStep = step + 1;
    // On entering the equipment/limitations steps, treat them as visited with
    // an empty default so "skip with empty" resolves to a valid array.
    const patched: Partial<PlanSpec> = { ...currentSpec };
    if (nextStep === 3 && patched.equipment == null) patched.equipment = [];
    if (nextStep === 6 && patched.limitations == null) patched.limitations = [];
    setSpec(patched);
    setBusy(true);
    try {
      await saveDraftAction(nextStep, patched);
      setStep(nextStep);
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = () => advance(spec);

  /**
   * Steps that accept exactly one value auto-advance on selection (issue #52).
   * Goal (1), location (2) and frequency (4) auto-advance. The duration step
   * (5) auto-advances only for preset cards and valid custom confirms — typing
   * never advances. Multi-choice steps (equipment 3, limitations 6) never
   * auto-advance.
   */
  const selectAndAdvance = (patch: Partial<PlanSpec>) => {
    void advance({ ...spec, ...patch });
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFinish = async () => {
    if (!isSpecComplete()) return;
    setBusy(true);
    try {
      // Persist the final raw answers, then promote + confirm. The server
      // derives preferenceScores on promote (source of truth); the client
      // never computes them. confirmPlanSpecAction triggers AI generation
      // and returns the planId for the new generating plan.
      await saveDraftAction(TOTAL_STEPS, spec);
      const { planId } = await confirmPlanSpecAction();
      router.push(`/plan/${planId}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStartOver = () => {
    setSpec({});
    setStep(1);
    setResumed(false);
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <GoalStep
            value={spec.goal}
            onSelect={(goal: PlanGoal) => selectAndAdvance({ goal })}
            messages={messages}
          />
        );
      case 2:
        return (
          <LocationStep
            value={spec.location}
            onSelect={(location: TrainingLocation) => selectAndAdvance({ location })}
            messages={messages}
          />
        );
      case 3:
        return (
          <EquipmentStep
            value={spec.equipment ?? []}
            location={spec.location}
            onSelect={(equipment: string[]) => update({ equipment })}
            messages={messages}
          />
        );
      case 4:
        return (
          <FrequencyStep
            value={spec.daysPerWeek}
            onSelect={(daysPerWeek: number) => selectAndAdvance({ daysPerWeek })}
            messages={messages}
          />
        );
      case 5:
        return (
          <DurationStep
            value={spec.sessionDurationMinutes}
            onSelect={(sessionDurationMinutes: number, source) => {
              if (source === "preset" || source === "custom") {
                // A preset click or a valid custom confirm commits and advances.
                selectAndAdvance({ sessionDurationMinutes });
              } else {
                update({ sessionDurationMinutes });
              }
            }}
            messages={messages}
          />
        );
      case 6:
        return (
          <LimitationsStep
            value={spec.limitations ?? []}
            onSelect={(limitations: PlanLimitation[]) => update({ limitations })}
            messages={messages}
          />
        );
      default:
        return null;
    }
  };

  const isLastStep = step === TOTAL_STEPS;

  return (
    <main className="kin-page">
      <header className={styles.header}>
        <OrbitProgress
          value={step - 1}
          max={TOTAL_STEPS - 1}
          size={64}
          aria-label={t("wizard_step_progress_aria", "Step {step} of {total}")
            .replace("{step}", String(step))
            .replace("{total}", String(TOTAL_STEPS))}
        >
          {`${step} / ${TOTAL_STEPS}`}
        </OrbitProgress>
        <h1 className={styles.question}>
          {t(STEP_QUESTIONS[step - 1]!.key, STEP_QUESTIONS[step - 1]!.fallback)}
        </h1>
        {resumed && (
          <button
            type="button"
            className={styles.startOver}
            onClick={handleStartOver}
          >
            {t("wizard_start_over", "Start over")}
          </button>
        )}
      </header>

      <section className={styles.body}>{renderStep()}</section>

      <footer className={styles.actions}>
        {step > 1 && (
          <button
            type="button"
            className={styles.back}
            onClick={handleBack}
            disabled={busy}
          >
            {t("wizard_back", "Back")}
          </button>
        )}
        {isLastStep ? (
          <button
            type="button"
            className={styles.primary}
            onClick={handleFinish}
            disabled={busy || !isSpecComplete()}
          >
            {t("wizard_finish", "Finish")}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            onClick={handleContinue}
            disabled={busy || !isCurrentStepComplete()}
          >
            {t("wizard_continue", "Continue")}
          </button>
        )}
      </footer>
    </main>
  );
}
