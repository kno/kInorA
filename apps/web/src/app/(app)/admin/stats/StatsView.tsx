"use client";

import { useTranslations } from "next-intl";
import type { PlatformStats, RetentionFunnelSteps } from "./stats-constants";
import styles from "../admin.module.css";

const TIERS = ["free", "pro", "trainer", "gym"] as const;

/**
 * Read-only platform-statistics view (GH #309). A client component (mirrors
 * `LogsView`) so it renders under the shared `NextIntlClientProvider` in tests,
 * but it holds NO client state and performs NO fetch — the server `page.tsx`
 * fetches the aggregates and passes them as the `stats` prop.
 *
 * It imports ONLY the client-safe `stats-constants` types — never the
 * server-only `stats-client` — and renders scalar counts / small enum-keyed
 * tallies. There is no per-tenant/per-user data to render.
 *
 * Presentation follows the Open Design `web-admin-stats.html` screen
 * (kno/kInorA#414): each domain is a panel with a head and a metric grid, the
 * effective-tier tally is a proportional split, and the retention funnel is a
 * bar per step. Nothing new is fetched and no figure is derived that the DTO
 * does not already carry.
 */
export function StatsView({ stats }: { stats: PlatformStats }) {
  const t = useTranslations("platformStats");

  const metric = (
    label: string,
    value: number,
    testId: string,
    options: { lead?: boolean; alert?: boolean } = {},
  ) => (
    <div
      className={`${styles.metric}${options.lead ? ` ${styles.metricLead}` : ""}${
        options.alert ? ` ${styles.metricAlert}` : ""
      }`}
      data-testid={testId}
    >
      <div className={styles.eyebrow}>{label}</div>
      <div className={styles.metricValue}>{value}</div>
    </div>
  );

  /**
   * A tier tally rendered as proportional bars. The count is always shown as a
   * number beside its bar — the bar is the comparison, never the claim.
   */
  const tierSplit = (
    tally: PlatformStats["billing"]["effectiveTier"],
    testIdPrefix: string,
  ) => {
    const max = Math.max(1, ...TIERS.map((tier) => tally[tier]));
    return (
      <div className={styles.split}>
        {TIERS.map((tier) => (
          <div className={styles.splitRow} key={tier} data-testid={`${testIdPrefix}-${tier}`}>
            <span className={styles.splitName}>{t(`tiers.${tier}`)}</span>
            <span className={styles.splitTrack}>
              <span style={{ width: `${(tally[tier] / max) * 100}%` }} />
            </span>
            <span className={styles.splitValue}>{tally[tier]}</span>
          </div>
        ))}
      </div>
    );
  };

  /**
   * One funnel step, ALWAYS rendered as "value of denominator" (#353).
   *
   * The denominator is not decoration and is not optional: "75%" and "3 of 4"
   * are the same ratio but not the same claim, and this page exists so
   * prioritisation calls stop being made on the first one. The percentage is
   * shown too, but only ever beside its n — which is also why the bar width is
   * driven by that same ratio and never stands alone.
   */
  const funnelStep = (
    label: string,
    value: number,
    denominator: number,
    testId: string,
  ) => {
    const ratio = denominator > 0 ? value / denominator : 0;
    return (
      <div className={styles.funnelRow} data-testid={testId}>
        <span className={styles.funnelLabel}>{label}</span>
        <span className={styles.funnelTrack}>
          <span style={{ width: `${ratio * 100}%` }} />
        </span>
        <span className={styles.funnelValue}>
          <strong>{t("retention.ofCount", { value, total: denominator })}</strong>
          {denominator > 0 ? <em>{Math.round(ratio * 100)}%</em> : null}
        </span>
      </div>
    );
  };

  const funnelSteps = (steps: RetentionFunnelSteps, testIdPrefix: string) => (
    <div className={styles.funnel}>
      {/* The top of the funnel has no denominator above it, so it is a plain
          count rather than a ratio against itself. */}
      <div className={`${styles.funnelRow} ${styles.funnelOrigin}`} data-testid={`${testIdPrefix}-signups`}>
        <span className={styles.funnelLabel}>{t("retention.signups")}</span>
        <span className={styles.funnelTrack}>
          <span style={{ width: "100%" }} />
        </span>
        <span className={styles.funnelValue}>
          <strong>{steps.signups}</strong>
        </span>
      </div>
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
      <div className={styles.funnelRow} data-testid={`${testIdPrefix}-trainer-sponsored`}>
        <span className={styles.funnelLabel}>{t("retention.trainerSponsored")}</span>
        <span className={styles.funnelTrack} />
        <span className={styles.funnelValue}>
          <strong>{steps.trainerSponsoredSignups}</strong>
        </span>
      </div>
    </div>
  );

  return (
    <div data-testid="stats-view">
      <section className={`${styles.panel} ${styles.section}`} aria-labelledby="stats-tenants">
        <div className={styles.panelHead}>
          <h2 id="stats-tenants">{t("sections.tenants")}</h2>
        </div>
        <div className={styles.panelBody}>
          <div className={`${styles.grid} ${styles.g3}`}>
            {metric(t("metrics.total"), stats.tenants.total, "tenants-total", { lead: true })}
            {metric(t("metrics.last7d"), stats.tenants.signups7d, "tenants-signups7d")}
            {metric(t("metrics.last30d"), stats.tenants.signups30d, "tenants-signups30d")}
          </div>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.section}`} aria-labelledby="stats-users">
        <div className={styles.panelHead}>
          <h2 id="stats-users">{t("sections.users")}</h2>
        </div>
        <div className={styles.panelBody}>
          <div className={`${styles.grid} ${styles.g3}`}>
            {metric(t("metrics.total"), stats.users.total, "users-total", { lead: true })}
            {metric(t("metrics.last7d"), stats.users.signups7d, "users-signups7d")}
            {metric(t("metrics.last30d"), stats.users.signups30d, "users-signups30d")}
          </div>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.section}`} aria-labelledby="stats-memberships">
        <div className={styles.panelHead}>
          <h2 id="stats-memberships">{t("sections.memberships")}</h2>
        </div>
        <div className={styles.panelBody}>
          <div className={`${styles.grid} ${styles.g3}`}>
            {metric(t("roles.owner"), stats.memberships.activeByRole.owner, "role-owner")}
            {metric(t("roles.member"), stats.memberships.activeByRole.member, "role-member")}
            {metric(t("roles.trainer"), stats.memberships.activeByRole.trainer, "role-trainer")}
          </div>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.section}`} aria-labelledby="stats-billing">
        <div className={styles.panelHead}>
          <h2 id="stats-billing">{t("sections.billing")}</h2>
        </div>
        <div className={`${styles.panelBody} ${styles.stack}`}>
          <div data-testid="billing-effective-tier">
            <div className={styles.eyebrow}>{t("billing.effectiveTier")}</div>
            {tierSplit(stats.billing.effectiveTier, "effective-tier")}
          </div>

          <div className={`${styles.grid} ${styles.g2}`}>
            {metric(
              t("billing.activeStripeSubscriptions"),
              stats.billing.activeStripeSubscriptions,
              "billing-active-subscriptions",
            )}
            {metric(t("billing.trials"), stats.billing.trials, "billing-trials")}
          </div>

          <div data-testid="billing-active-overrides">
            <div className={styles.eyebrow}>{t("billing.activeOverrides")}</div>
            <div className={`${styles.grid} ${styles.g4}`}>
              {TIERS.map((tier) => (
                <div className={styles.metric} key={tier} data-testid={`override-tier-${tier}`}>
                  <div className={styles.eyebrow}>{t(`tiers.${tier}`)}</div>
                  <div className={`${styles.metricValue} ${styles.metricValueSm}`}>
                    {stats.billing.activeOverridesByTier[tier]}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.section}`} aria-labelledby="stats-usage">
        <div className={styles.panelHead}>
          <h2 id="stats-usage">{t("sections.usage")}</h2>
          <span className={styles.pill} data-testid="usage-period">
            {t("usage.period")}: {stats.usage.thisPeriod}
          </span>
        </div>
        <div className={styles.panelBody}>
          <div className={`${styles.grid} ${styles.g4}`}>
            {metric(
              t("usage.planGeneration"),
              stats.usage.byFeature.plan_generation,
              "usage-plan-generation",
            )}
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
        </div>
      </section>

      <section className={`${styles.panel} ${styles.section}`} aria-labelledby="stats-retention">
        <div className={styles.panelHead}>
          <h2 id="stats-retention">{t("sections.retention")}</h2>
        </div>
        <div className={`${styles.panelBody} ${styles.stack}`}>
          <p className={styles.hint} data-testid="retention-window">
            {t("retention.window", { weeks: stats.retention.windowWeeks })}
          </p>

          <div data-testid="retention-totals">
            <div className={styles.eyebrow}>{t("funnelTitle")}</div>
            <p className={styles.hint}>{t("retention.totals")}</p>
            {funnelSteps(stats.retention.totals, "retention-totals")}
          </div>

          <div className={`${styles.grid} ${styles.g2}`}>
            {metric(
              t("retention.abandonedSessions", {
                hours: stats.retention.abandonedSessionThresholdHours,
              }),
              stats.retention.abandonedSessions,
              "retention-abandoned-sessions",
            )}
          </div>

          {stats.retention.cohorts.length > 0 && (
            <div>
              <div className={styles.eyebrow}>{t("cohortsTitle")}</div>
              <div className={styles.stack}>
                {stats.retention.cohorts.map((cohort) => (
                  <div key={cohort.weekStart} data-testid={`retention-cohort-${cohort.weekStart}`}>
                    <p className={styles.hint}>
                      {t("retention.weekOf", { date: cohort.weekStart })}
                    </p>
                    {funnelSteps(cohort, `retention-${cohort.weekStart}`)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className={`${styles.panel} ${styles.section}`} aria-labelledby="stats-observability">
        <div className={styles.panelHead}>
          <h2 id="stats-observability">{t("sections.observability")}</h2>
        </div>
        <div className={styles.panelBody}>
          <div className={`${styles.grid} ${styles.g2}`}>
            {metric(t("observability.errors24h"), stats.observability.errors24h, "obs-errors24h", {
              alert: stats.observability.errors24h > 0,
            })}
            {metric(t("observability.events24h"), stats.observability.events24h, "obs-events24h")}
          </div>
        </div>
      </section>
    </div>
  );
}
