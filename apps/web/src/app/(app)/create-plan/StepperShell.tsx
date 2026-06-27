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
  /** Promotes the draft to a confirmed PlanSpec (POST /plan-specs) then redirects. */
  confirmPlanSpecAction: () => Promise<void>;
}

const STEP_QUESTIONS = [
  "What is your main goal?",
  "Where will you train?",
  "How many days per week?",
  "How long is each session?",
  "What equipment do you have?",
  "Any limitations to keep in mind?",
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
}: StepperShellProps) {
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
        return spec.daysPerWeek != null;
      case 4:
        return spec.sessionDurationMinutes != null;
      case 5:
        return spec.equipment != null; // empty array is valid once visited
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

  const handleContinue = async () => {
    const nextStep = step + 1;
    // On entering the equipment/limitations steps, treat them as visited with
    // an empty default so "skip with empty" resolves to a valid array.
    const patched: Partial<PlanSpec> = { ...spec };
    if (nextStep === 5 && patched.equipment == null) patched.equipment = [];
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

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFinish = async () => {
    if (!isSpecComplete()) return;
    setBusy(true);
    try {
      // Persist the final raw answers, then promote. The server derives
      // preferenceScores on promote (source of truth); the client never
      // computes them.
      await saveDraftAction(TOTAL_STEPS, spec);
      await confirmPlanSpecAction();
      router.push("/plan");
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
          <GoalStep value={spec.goal} onSelect={(goal: PlanGoal) => update({ goal })} />
        );
      case 2:
        return (
          <LocationStep
            value={spec.location}
            onSelect={(location: TrainingLocation) => update({ location })}
          />
        );
      case 3:
        return (
          <FrequencyStep
            value={spec.daysPerWeek}
            onSelect={(daysPerWeek: number) => update({ daysPerWeek })}
          />
        );
      case 4:
        return (
          <DurationStep
            value={spec.sessionDurationMinutes}
            onSelect={(sessionDurationMinutes: number) =>
              update({ sessionDurationMinutes })
            }
          />
        );
      case 5:
        return (
          <EquipmentStep
            value={spec.equipment ?? []}
            location={spec.location}
            onSelect={(equipment: string[]) => update({ equipment })}
          />
        );
      case 6:
        return (
          <LimitationsStep
            value={spec.limitations ?? []}
            onSelect={(limitations: PlanLimitation[]) => update({ limitations })}
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
          aria-label={`Step ${step} of ${TOTAL_STEPS}`}
        >
          {`${step} / ${TOTAL_STEPS}`}
        </OrbitProgress>
        <h1 className={styles.question}>{STEP_QUESTIONS[step - 1]}</h1>
        {resumed && (
          <button
            type="button"
            className={styles.startOver}
            onClick={handleStartOver}
          >
            Start over
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
            Back
          </button>
        )}
        {isLastStep ? (
          <button
            type="button"
            className={styles.primary}
            onClick={handleFinish}
            disabled={busy || !isSpecComplete()}
          >
            Finish
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            onClick={handleContinue}
            disabled={busy || !isCurrentStepComplete()}
          >
            Continue
          </button>
        )}
      </footer>
    </main>
  );
}
