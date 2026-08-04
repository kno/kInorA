"use client";

import { useTranslations } from "next-intl";

const GYM_VISUAL_URL = "https://gymvisual.com/";
const DATASET_URL = "https://github.com/hasaneyldrm/exercises-dataset";

/**
 * ExerciseAttribution — the third-party notice that MUST accompany the
 * exercise library wherever its media is displayed.
 *
 * This is a licensing obligation, not decoration (see
 * `public/exercises/ATTRIBUTION.md`): the demonstration media is © Gym visual
 * and is NOT covered by kInorA's licence, while the underlying data is MIT
 * from the exercises-dataset project. Every record also carries the notice in
 * its `attribution` field — do not remove this block to tidy a layout.
 *
 * A client component (rather than an async server one) so both the library
 * and the detail server pages can drop it in synchronously.
 */
export function ExerciseAttribution() {
  const t = useTranslations();

  return (
    <aside className="kin-ex-attribution" aria-label={t("exercises.attribution.heading")}>
      <h2 className="kin-ex-attribution__heading">{t("exercises.attribution.heading")}</h2>
      <p className="kin-ex-attribution__text">
        {t("exercises.attribution.media")}{" "}
        <a href={GYM_VISUAL_URL} target="_blank" rel="noreferrer noopener">
          {t("exercises.attribution.mediaLink")}
        </a>
      </p>
      <p className="kin-ex-attribution__text">
        {t("exercises.attribution.data")}{" "}
        <a href={DATASET_URL} target="_blank" rel="noreferrer noopener">
          {t("exercises.attribution.dataLink")}
        </a>
      </p>
    </aside>
  );
}
