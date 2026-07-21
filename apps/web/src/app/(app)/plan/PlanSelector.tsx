"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";

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
  /**
   * Resolved plan label (#93). The server normally resolves the blank→default
   * rule via `defaultPlanName`, so this is usually a non-empty string. It stays
   * OPTIONAL, though, so the selector keeps a client-side date/status fallback
   * to stay safe for legacy clients or any summary served without a name.
   */
  name?: string;
}

export interface PlanSelectorProps {
  summaries: PlanSummaryItem[];
  selectedId: string;
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
export function PlanSelector({ summaries, selectedId }: PlanSelectorProps) {
  const router = useRouter();
  const t = useTranslations();
  const format = useFormatter();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    router.push(`/plan?planId=${encodeURIComponent(e.target.value)}`);
  }

  return (
    <div className="kin-plan-selector">
      <label htmlFor="plan-selector" className="kin-label">
        {t("plan.selector.label")}
      </label>
      <select
        id="plan-selector"
        value={selectedId}
        onChange={handleChange}
        className="kin-select"
      >
        {summaries.map((plan) => {
          // #93: prefer the server-resolved plan name as the primary option
          // label. The server normally resolves it via defaultPlanName, but the
          // field is optional, so fall back to the date/status template for any
          // legacy/undefined summary served without a name (no crash).
          const date = format.dateTime(new Date(plan.createdAt), {
            year: "numeric",
            month: "short",
            day: "numeric",
          });
          const statusLabel = t("plan.selector.option", { status: plan.status });
          const optionLabel = plan.name ? plan.name : `${date} (${statusLabel})`;
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
