"use client";

import { useTranslations } from "next-intl";
import type { PlatformStats, RetentionFunnelSteps } from "./stats-constants";

/**
 * Read-only platform-statistics view (GH #309). A client component (mirrors
 * `LogsView`) so it renders under the shared `NextIntlClientProvider` in tests,
 * but it holds NO client state and performs NO fetch — the server `page.tsx`
 * fetches the aggregates and passes them as the `stats` prop.
 *
 * It imports ONLY the client-safe `stats-constants` types — never the
 * server-only `stats-client` — and renders scalar counts / small enum-keyed
 * tallies as cards. There is no per-tenant/per-user data to render.
 */
export function StatsView({ stats }: { stats: PlatformStats }) {
  const t = useTranslations("platformStats");

  const metric = (label: string, value: number, testId: string) => (
    <div className="kin-card" data-testid={testId}>
      <span className="kin-muted">{label}</span>
      <strong style={{ fontSize: "1.5rem", display: "block" }}>{value}</strong>
    </div>
  );

  const tierRows = (
    tally: PlatformStats["billing"]["effectiveTier"],
    testIdPrefix: string,
  ) => (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {(["free", "pro", "trainer", "gym"] as const).map((tier) => (
        <li key={tier} data-testid={`${testIdPrefix}-${tier}`}>
          {t(`tiers.${tier}`)}: <strong>{tally[tier]}</strong>
        </li>
      ))}
    </ul>
  );

  /**
   * One funnel step, ALWAYS rendered as "value of denominator" (#353).
   *
   * The denominator is not decoration and is not optional: "75%" and "3 of 4"
   * are the same ratio but not the same claim, and this page exists so
   * prioritisation calls stop being made on the first one. The percentage is
   * shown too, but only ever beside its n.
   */
  const funnelStep = (
    label: string,
    value: number,
    denominator: number,
    testId: string,
  ) => (
    <li data-testid={testId}>
      <span className="kin-muted">{label}</span>{" "}
      <strong>{t("retention.ofCount", { value, total: denominator })}</strong>
      {denominator > 0 ? (
        <span className="kin-muted">
          {" "}
          ({Math.round((value / denominator) * 100)}%)
        </span>
      ) : null}
    </li>
  );

  const funnelSteps = (steps: RetentionFunnelSteps, testIdPrefix: string) => (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: "0.25rem" }}>
      {/* The top of the funnel has no denominator above it, so it is a plain
          count rather than a ratio against itself. */}
      <li data-testid={`${testIdPrefix}-signups`}>
        <span className="kin-muted">{t("retention.signups")}</span>{" "}
        <strong>{steps.signups}</strong>
      </li>
      {funnelStep(
        t("retention.createdPlan"),
        steps.createdPlan,
        steps.signups,
        `${testIdPrefix}-created-plan`,
      )}
      {funnelStep(
        t("retention.completedFirstWorkout"),
        steps.completedFirstWorkout,
        steps.createdPlan,
        `${testIdPrefix}-first-workout`,
      )}
      {funnelStep(
        t("retention.completedSecondWorkout"),
        steps.completedSecondWorkoutWithin7d,
        steps.completedFirstWorkout,
        `${testIdPrefix}-second-workout`,
      )}
      {funnelStep(
        t("retention.activeWeek2"),
        steps.activeWeek2,
        steps.completedSecondWorkoutWithin7d,
        `${testIdPrefix}-week2`,
      )}
      {funnelStep(
        t("retention.activeWeek4"),
        steps.activeWeek4,
        steps.completedSecondWorkoutWithin7d,
        `${testIdPrefix}-week4`,
      )}
      <li data-testid={`${testIdPrefix}-trainer-sponsored`}>
        <span className="kin-muted">{t("retention.trainerSponsored")}</span>{" "}
        <strong>{steps.trainerSponsoredSignups}</strong>
      </li>
    </ul>
  );

  return (
    <div style={{ display: "grid", gap: "1.5rem" }} data-testid="stats-view">
      <section aria-labelledby="stats-tenants">
        <h2 id="stats-tenants">{t("sections.tenants")}</h2>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(3, 1fr)" }}>
          {metric(t("metrics.total"), stats.tenants.total, "tenants-total")}
          {metric(t("metrics.last7d"), stats.tenants.signups7d, "tenants-signups7d")}
          {metric(t("metrics.last30d"), stats.tenants.signups30d, "tenants-signups30d")}
        </div>
      </section>

      <section aria-labelledby="stats-users">
        <h2 id="stats-users">{t("sections.users")}</h2>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(3, 1fr)" }}>
          {metric(t("metrics.total"), stats.users.total, "users-total")}
          {metric(t("metrics.last7d"), stats.users.signups7d, "users-signups7d")}
          {metric(t("metrics.last30d"), stats.users.signups30d, "users-signups30d")}
        </div>
      </section>

      <section aria-labelledby="stats-memberships">
        <h2 id="stats-memberships">{t("sections.memberships")}</h2>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(3, 1fr)" }}>
          {metric(t("roles.owner"), stats.memberships.activeByRole.owner, "role-owner")}
          {metric(t("roles.member"), stats.memberships.activeByRole.member, "role-member")}
          {metric(t("roles.trainer"), stats.memberships.activeByRole.trainer, "role-trainer")}
        </div>
      </section>

      <section aria-labelledby="stats-billing">
        <h2 id="stats-billing">{t("sections.billing")}</h2>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div className="kin-card" data-testid="billing-effective-tier">
            <span className="kin-muted">{t("billing.effectiveTier")}</span>
            {tierRows(stats.billing.effectiveTier, "effective-tier")}
          </div>
          {metric(
            t("billing.activeStripeSubscriptions"),
            stats.billing.activeStripeSubscriptions,
            "billing-active-subscriptions",
          )}
          {metric(t("billing.trials"), stats.billing.trials, "billing-trials")}
          <div className="kin-card" data-testid="billing-active-overrides">
            <span className="kin-muted">{t("billing.activeOverrides")}</span>
            {tierRows(stats.billing.activeOverridesByTier, "override-tier")}
          </div>
        </div>
      </section>

      <section aria-labelledby="stats-usage">
        <h2 id="stats-usage">{t("sections.usage")}</h2>
        <p className="kin-muted" data-testid="usage-period">
          {t("usage.period")}: {stats.usage.thisPeriod}
        </p>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(2, 1fr)" }}>
          {metric(t("usage.planGeneration"), stats.usage.byFeature.plan_generation, "usage-plan-generation")}
          {metric(
            t("usage.planRegeneration"),
            stats.usage.byFeature.plan_regeneration,
            "usage-plan-regeneration",
          )}
          {metric(t("usage.memoryWrite"), stats.usage.byFeature.memory_write, "usage-memory-write")}
          {metric(
            t("usage.memoryRetrieval"),
            stats.usage.byFeature.memory_retrieval,
            "usage-memory-retrieval",
          )}
        </div>
      </section>

      <section aria-labelledby="stats-retention">
        <h2 id="stats-retention">{t("sections.retention")}</h2>
        <p className="kin-muted" data-testid="retention-window">
          {t("retention.window", { weeks: stats.retention.windowWeeks })}
        </p>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div className="kin-card" data-testid="retention-totals">
            <span className="kin-muted">{t("retention.totals")}</span>
            {funnelSteps(stats.retention.totals, "retention-totals")}
          </div>
          {metric(
            t("retention.abandonedSessions", {
              hours: stats.retention.abandonedSessionThresholdHours,
            }),
            stats.retention.abandonedSessions,
            "retention-abandoned-sessions",
          )}
          {stats.retention.cohorts.map((cohort) => (
            <div
              className="kin-card"
              key={cohort.weekStart}
              data-testid={`retention-cohort-${cohort.weekStart}`}
            >
              <span className="kin-muted">
                {t("retention.weekOf", { date: cohort.weekStart })}
              </span>
              {funnelSteps(cohort, `retention-${cohort.weekStart}`)}
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="stats-observability">
        <h2 id="stats-observability">{t("sections.observability")}</h2>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(2, 1fr)" }}>
          {metric(t("observability.errors24h"), stats.observability.errors24h, "obs-errors24h")}
          {metric(t("observability.events24h"), stats.observability.events24h, "obs-events24h")}
        </div>
      </section>
    </div>
  );
}
