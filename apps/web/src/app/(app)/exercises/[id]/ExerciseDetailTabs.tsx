"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  taxonomyLabel,
  taxonomyList,
  type TaxonomyTranslator,
} from "../taxonomy";

export interface ExerciseDetailTabsProps {
  /** Ordered how-to steps, already resolved to the reader's locale. */
  steps: string[];
  bodyPart: string;
  target: string;
  muscleGroup: string;
  secondaryMuscles: string[];
}

type TabId = "execution" | "muscles";

const TABS: TabId[] = ["execution", "muscles"];

/**
 * ExerciseDetailTabs — the numbered execution list and the muscle breakdown,
 * behind the two-tab switch from Open Design
 * `screens/web-exercise-detail.html`.
 *
 * The design's second tab held hand-written "coach cues". The real dataset has
 * no such field and inventing one would put fabricated coaching advice in
 * front of a user lifting weights, so the tab shows the muscle breakdown the
 * records DO carry (body part, muscle group, primary target, assisting
 * muscles) instead.
 */
export function ExerciseDetailTabs({
  steps,
  bodyPart,
  target,
  muscleGroup,
  secondaryMuscles,
}: ExerciseDetailTabsProps) {
  const t = useTranslations();
  const [active, setActive] = useState<TabId>("execution");
  // See `taxonomy.ts` — runtime-built keys cannot satisfy next-intl's literal
  // message-path typing.
  const tax = t as unknown as TaxonomyTranslator;

  return (
    <div className="kin-ex-tabs-block">
      <div className="kin-ex-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`exercise-tab-${tab}`}
            aria-selected={active === tab}
            aria-controls={`exercise-panel-${tab}`}
            className={`kin-ex-tab${active === tab ? " kin-ex-tab--active" : ""}`}
            onClick={() => setActive(tab)}
          >
            {tab === "execution"
              ? t("exercises.detail.tabs.execution")
              : t("exercises.detail.tabs.muscles")}
          </button>
        ))}
      </div>

      {active === "execution" ? (
        <ol
          className="kin-ex-steps"
          role="tabpanel"
          id="exercise-panel-execution"
          aria-labelledby="exercise-tab-execution"
        >
          {steps.map((step, index) => (
            <li className="kin-ex-step" key={`${index}-${step}`}>
              <span className="kin-ex-step__num" aria-hidden="true">
                {index + 1}
              </span>
              <p className="kin-ex-step__text">{step}</p>
            </li>
          ))}
        </ol>
      ) : (
        <dl
          className="kin-ex-muscles"
          role="tabpanel"
          id="exercise-panel-muscles"
          aria-labelledby="exercise-tab-muscles"
        >
          <div className="kin-ex-muscle">
            <dt>{t("exercises.detail.stats.bodyPart")}</dt>
            <dd>{taxonomyLabel(tax, bodyPart)}</dd>
          </div>
          <div className="kin-ex-muscle">
            <dt>{t("exercises.detail.muscleGroup")}</dt>
            <dd>{taxonomyLabel(tax, muscleGroup)}</dd>
          </div>
          <div className="kin-ex-muscle">
            <dt>{t("exercises.detail.stats.target")}</dt>
            <dd>{taxonomyLabel(tax, target)}</dd>
          </div>
          <div className="kin-ex-muscle">
            <dt>{t("exercises.detail.stats.secondary")}</dt>
            <dd>
              {secondaryMuscles.length > 0
                ? taxonomyList(tax, secondaryMuscles)
                : t("exercises.detail.noSecondaryMuscles")}
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
