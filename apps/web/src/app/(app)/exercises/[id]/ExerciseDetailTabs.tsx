"use client";

import { useRef, useState } from "react";
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
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  // See `taxonomy.ts` — runtime-built keys cannot satisfy next-intl's literal
  // message-path typing.
  const tax = t as unknown as TaxonomyTranslator;

  /**
   * The ARIA tabs keyboard pattern: Arrow/Home/End move between tabs, wrapping
   * at both ends, and selection follows focus (both panels are already
   * rendered from data in hand, so activating on focus costs nothing).
   *
   * Announcing `role="tablist"` PROMISES this to a screen-reader user. Without
   * it the arrow keys did nothing and the tabs were reachable only with Tab,
   * which is the roving-tabindex behaviour below being contradicted.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TABS.length - 1;
    let target: number;

    switch (event.key) {
      case "ArrowRight":
        target = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
        target = index === 0 ? last : index - 1;
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = last;
        break;
      default:
        return;
    }

    // Only once a key we OWN was pressed — Tab must keep leaving the tablist.
    event.preventDefault();
    const tab = TABS[target]!;
    setActive(tab);
    tabRefs.current[tab]?.focus();
  }

  return (
    <div className="kin-ex-tabs-block">
      <div className="kin-ex-tabs" role="tablist">
        {TABS.map((tab, index) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`exercise-tab-${tab}`}
            ref={(node) => {
              tabRefs.current[tab] = node;
            }}
            aria-selected={active === tab}
            aria-controls={`exercise-panel-${tab}`}
            // Roving tabindex: the tablist is ONE tab stop, and the arrow keys
            // move within it.
            tabIndex={active === tab ? 0 : -1}
            className={`kin-ex-tab${active === tab ? " kin-ex-tab--active" : ""}`}
            onClick={() => setActive(tab)}
            onKeyDown={(event) => handleKeyDown(event, index)}
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
          // The panel is the next tab stop after the tablist, so a keyboard
          // reader reaches its content without hunting for a focusable child.
          tabIndex={0}
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
          tabIndex={0}
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
