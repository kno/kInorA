import type { MuscleGroup, StatsSummaryDTO } from "@kinora/contracts";

/**
 * Web-only presentation collapse: the 10 primary `MuscleGroup` domain
 * buckets down to the 6 coarser display buckets `web-stats.html` shows in
 * the "Series por grupo muscular" bar chart (design.md "Muscle-group
 * distribution: how it's aggregated vs. how it's shown" — 09c-v1
 * progress-dashboard-stats, Slice 3b). This mapping is presentation-only and
 * lives in the web layer; the domain/DTO always stay 10-group.
 *
 * Four of the six coarse buckets are 1:1 with a primary group (back, chest,
 * shoulders, core) and reuse that group's `progress.muscle.<slug>` label.
 * The remaining two are real merges — "legs" (quads + hamstrings + calves +
 * glutes) and "arms" (biceps + triceps) — and get their own composite
 * `progress.muscle.legs` / `progress.muscle.arms` labels.
 */
export type CoarseMuscleGroup = "back" | "legs" | "chest" | "shoulders" | "arms" | "core";

const COARSE_GROUP_ORDER: readonly CoarseMuscleGroup[] = ["back", "legs", "chest", "shoulders", "arms", "core"];

const TO_COARSE: Record<MuscleGroup, CoarseMuscleGroup> = {
  back: "back",
  quads: "legs",
  hamstrings: "legs",
  calves: "legs",
  glutes: "legs",
  chest: "chest",
  shoulders: "shoulders",
  biceps: "arms",
  triceps: "arms",
  core: "core",
};

export interface CoarseMuscleGroupBar {
  group: CoarseMuscleGroup;
  setCount: number;
  /** 0-100, relative to the largest bucket (0 when there is no data). */
  percentOfMax: number;
}

/**
 * Collapses the DTO's 10-group `muscleGroupDistribution` (set counts) into
 * the 6 coarse display buckets, in the design's fixed order. Buckets that
 * received no contribution are omitted — mirrors the domain's own
 * "unmapped exercises don't produce a bucket" degrade.
 */
export function toCoarseMuscleGroupBars(
  distribution: StatsSummaryDTO["muscleGroupDistribution"],
): CoarseMuscleGroupBar[] {
  const totals = new Map<CoarseMuscleGroup, number>();

  for (const row of distribution) {
    const coarse = TO_COARSE[row.muscleGroup];
    totals.set(coarse, (totals.get(coarse) ?? 0) + row.setCount);
  }

  const maxSetCount = Math.max(0, ...totals.values());

  return COARSE_GROUP_ORDER.filter((group) => totals.has(group)).map((group) => {
    const setCount = totals.get(group)!;
    return {
      group,
      setCount,
      percentOfMax: maxSetCount > 0 ? Math.round((setCount / maxSetCount) * 100) : 0,
    };
  });
}
