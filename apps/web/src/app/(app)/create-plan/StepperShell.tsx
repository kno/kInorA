"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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

/**
 * Wizard draft shape (#93). The plan `name` is NOT a `PlanSpec` field — it is
 * persisted on `workout_plans`, resolved server-side via `defaultPlanName` on
 * read. It rides along in the untyped draft JSON as an optional key so the
 * wizard can capture it without changing the shared `PlanSpec` contract.
 */
export type DraftSpec = Partial<PlanSpec> & { name?: string | null };

export interface InitialDraft {
  step: number;
  spec: DraftSpec;
}

export interface StepperShellProps {
  /** Hydrated server draft (resume). Absent → fresh wizard at step 1. */
  initialDraft?: InitialDraft;
  /**
   * Persists the current step + spec to the server (POST /plan-specs/drafts).
   * Accepts a DraftSpec so the optional plan `name` (#93) rides along in the
   * draft JSON without changing the shared PlanSpec contract.
   */
  saveDraftAction: (step: number, spec: DraftSpec) => Promise<void>;
  /**
   * Promotes the draft to a confirmed PlanSpec and triggers AI generation.
   * Returns { planId, status } so the shell can navigate to /plan/[planId].
   */
  confirmPlanSpecAction: () => Promise<{ planId: string; status: string }>;
}

/** Catalog keys for the six step titles, in step order. */
const STEP_QUESTION_KEYS: readonly string[] = [
  "wizard.step.goalTitle",
  "wizard.step.locationTitle",
  "wizard.step.equipmentTitle",
  "wizard.step.frequencyTitle",
  "wizard.step.durationTitle",
  "wizard.step.limitationsTitle",
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
  const t = useTranslations();
  const router = useRouter();
  const [step, setStep] = useState(initialDraft?.step ?? 1);
  const [spec, setSpec] = useState<DraftSpec>(initialDraft?.spec ?? {});
  // #93: the plan name is held in its OWN state (not in `spec`) because it is not
  // a PlanSpec field and only merges into the submitted draft on finish — never
  // on step-advance, so typing it never triggers the auto-advance/save path.
  const [name, setName] = useState<string>(initialDraft?.spec.name ?? "");
  const [resumed, setResumed] = useState(Boolean(initialDraft));
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<PlanSpec>) => {
    setSpec((prev) => ({ ...prev, ...patch }));
  };

  /**
   * Resolve the captured plan name for submission (#93). A blank/whitespace-only
   * value becomes `null` so the API applies the date-based default; a non-blank
   * value is trimmed and passed through.
   */
  const normalizeNameForSubmit = (): string | null => {
    const trimmed = name.trim();
    return trimmed === "" ? null : trimmed;
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
      // #93: attach the optional plan name (blank → null) to the final draft.
      await saveDraftAction(TOTAL_STEPS, { ...spec, name: normalizeNameForSubmit() });
      const { planId } = await confirmPlanSpecAction();
      router.push(`/plan/${planId}`);
    } finally {
      setBusy(false);
    }
  };

  const handleStartOver = () => {
    setSpec({});
    setName("");
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
          />
        );
      case 2:
        return (
          <LocationStep
            value={spec.location}
            onSelect={(location: TrainingLocation) => selectAndAdvance({ location })}
          />
        );
      case 3:
        return (
          <EquipmentStep
            value={spec.equipment ?? []}
            location={spec.location}
            onSelect={(equipment: string[]) => update({ equipment })}
          />
        );
      case 4:
        return (
          <FrequencyStep
            value={spec.daysPerWeek}
            onSelect={(daysPerWeek: number) => selectAndAdvance({ daysPerWeek })}
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
          />
        );
      case 6:
        return (
          <>
            <LimitationsStep
              value={spec.limitations ?? []}
              onSelect={(limitations: PlanLimitation[]) => update({ limitations })}
            />
            {/* Optional plan name (#93). Blank is allowed — the server resolves a
                date-based default via defaultPlanName on read. */}
            <div className={styles.nameField}>
              <label htmlFor="plan-name" className="kin-label">
                {t("plan.name.fieldLabel")}
              </label>
              <input
                id="plan-name"
                type="text"
                className="kin-input"
                maxLength={120}
                value={name}
                placeholder={t("plan.name.placeholder")}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </>
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
          aria-label={t("wizard.step.progressAria", { step, total: TOTAL_STEPS })}
        >
          {`${step} / ${TOTAL_STEPS}`}
        </OrbitProgress>
        <h1 className={styles.question}>{t(STEP_QUESTION_KEYS[step - 1]!)}</h1>
        {resumed && (
          <button
            type="button"
            className={styles.startOver}
            onClick={handleStartOver}
          >
            {t("wizard.startOver")}
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
            {t("wizard.back")}
          </button>
        )}
        {isLastStep ? (
          <button
            type="button"
            className={styles.primary}
            onClick={handleFinish}
            disabled={busy || !isSpecComplete()}
          >
            {t("wizard.finish")}
          </button>
        ) : (
          <button
            type="button"
            className={styles.primary}
            onClick={handleContinue}
            disabled={busy || !isCurrentStepComplete()}
          >
            {t("wizard.continue")}
          </button>
        )}
      </footer>
    </main>
  );
}
