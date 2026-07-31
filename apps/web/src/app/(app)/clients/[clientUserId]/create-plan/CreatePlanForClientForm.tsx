"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PlanGoal, TrainingLocation } from "@kinora/contracts";
import type { CreatePlanForClientInput, CreatePlanForClientResult } from "../../trainer-client-types";

export interface CreatePlanForClientFormProps {
  clientUserId: string;
  createPlanForClientAction: (
    clientUserId: string,
    input: CreatePlanForClientInput,
  ) => Promise<CreatePlanForClientResult>;
}

const GOALS: PlanGoal[] = ["strength", "hypertrophy", "fat_loss", "general_fitness"];
const LOCATIONS: TrainingLocation[] = ["home", "gym", "outdoor"];

/**
 * Minimal create-plan-for-client form (15a-v2-trainer-account-access, Slice
 * 5). A dedicated, self-contained form rather than reusing the multi-mode
 * `CreatePlanShell` wizard (Asistente/Formulario + shared-draft state) — the
 * client-owned route has NO draft phase server-side (`plan.ts`'s
 * `buildConfirmedSpecFromInput` accepts the full flat spec directly), so this
 * captures the same required fields in one step and posts once via
 * `POST /clients/:clientUserId/plan-specs`. Equipment/limitations default to
 * empty arrays (both valid per `assertPlanSpecInput`).
 */
export function CreatePlanForClientForm({
  clientUserId,
  createPlanForClientAction,
}: CreatePlanForClientFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const [goal, setGoal] = useState<PlanGoal>("strength");
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(45);
  const [location, setLocation] = useState<TrainingLocation>("gym");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await createPlanForClientAction(clientUserId, {
        goal,
        daysPerWeek,
        sessionDurationMinutes,
        location,
        equipment: [],
        limitations: [],
      });

      if (result.kind === "ok") {
        router.push(`/plan/${result.planId}`);
        return;
      }

      setError(
        result.message === "forbidden"
          ? t("clients.createPlan.errorForbidden")
          : t("clients.createPlan.errorGeneric"),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="kin-page">
      <h1 className="kin-title">{t("clients.createPlan.title")}</h1>
      <form onSubmit={handleSubmit} className="kin-card">
        <label htmlFor="plan-goal">{t("clients.createPlan.goalLabel")}</label>
        <select
          id="plan-goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value as PlanGoal)}
          disabled={submitting}
        >
          {GOALS.map((g) => (
            <option key={g} value={g}>
              {t(`wizard.goal.${camelCase(g)}.label`)}
            </option>
          ))}
        </select>

        <label htmlFor="plan-days">{t("clients.createPlan.daysPerWeekLabel")}</label>
        <input
          id="plan-days"
          type="number"
          min={1}
          max={7}
          value={daysPerWeek}
          onChange={(e) => setDaysPerWeek(Number(e.target.value))}
          disabled={submitting}
        />

        <label htmlFor="plan-duration">{t("clients.createPlan.sessionDurationLabel")}</label>
        <input
          id="plan-duration"
          type="number"
          min={15}
          max={240}
          value={sessionDurationMinutes}
          onChange={(e) => setSessionDurationMinutes(Number(e.target.value))}
          disabled={submitting}
        />

        <label htmlFor="plan-location">{t("clients.createPlan.locationLabel")}</label>
        <select
          id="plan-location"
          value={location}
          onChange={(e) => setLocation(e.target.value as TrainingLocation)}
          disabled={submitting}
        >
          {LOCATIONS.map((loc) => (
            <option key={loc} value={loc}>
              {t(`wizard.location.${loc}.label`)}
            </option>
          ))}
        </select>

        <button type="submit" className="kin-btn kin-btn--accent" disabled={submitting}>
          {submitting ? t("clients.createPlan.submitting") : t("clients.createPlan.submit")}
        </button>

        {error && (
          <p role="alert" className="kin-text">
            {error}
          </p>
        )}
      </form>
    </main>
  );
}

/** `fat_loss` -> `fatLoss`, `general_fitness` -> `generalFitness` (matches the wizard catalog's key casing). */
function camelCase(goal: PlanGoal): string {
  return goal.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
