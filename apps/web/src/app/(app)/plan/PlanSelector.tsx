"use client";

import { useRouter } from "next/navigation";

/**
 * Lightweight plan summary shape for the selector.
 * Intentionally duplicated from PlanSummary in plan-draft-client to avoid
 * importing a server-only module into this client component (ui-api-guard
 * enforces this boundary — plan-draft-client has `import "server-only"`).
 */
export interface PlanSummaryItem {
  id: string;
  status: string;
  createdAt: string;
}

export interface PlanSelectorProps {
  summaries: PlanSummaryItem[];
  selectedId: string;
  messages?: Record<string, string>;
}

/**
 * PlanSelector — client component for picking a workout plan.
 *
 * Renders a <select> element listing the user's plans (newest-first, as
 * provided by the server component). On change it navigates to
 * `/plan?planId=<encoded-id>` via router.push, which causes the server component
 * to re-render and load the selected plan's detail server-side.
 *
 * planId is URL-encoded (encodeURIComponent) to handle UUIDs with special
 * characters safely, even though current IDs are plain UUIDs.
 *
 * This component MUST NOT import plan-draft-client or any server-only module,
 * and MUST NOT reference API_BASE_URL / NEXT_PUBLIC_API_BASE_URL — it only
 * navigates (ui-api-guard enforces this at build time).
 */
export function PlanSelector({ summaries, selectedId, messages }: PlanSelectorProps) {
  const router = useRouter();

  // Translate with fallback
  const t = (key: string, fallback: string) => messages?.[key] ?? fallback;

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/plan?planId=${encodeURIComponent(e.target.value)}`);
  }

  return (
    <div className="kin-plan-selector">
      <label htmlFor="plan-selector" className="kin-label">
        {t("plan_selector_label", "Select a plan")}
      </label>
      <select
        id="plan-selector"
        value={selectedId}
        onChange={handleChange}
        className="kin-select"
      >
        {summaries.map((plan) => {
          const date = new Date(plan.createdAt).toLocaleDateString();
          // plan_selector_option template: "{date} ({status})"
          const optionLabel = t("plan_selector_option", "{date} ({status})")
            .replace("{date}", date)
            .replace("{status}", plan.status);
          return (
            <option key={plan.id} value={plan.id}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </div>
  );
}
