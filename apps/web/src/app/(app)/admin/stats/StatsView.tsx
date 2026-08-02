"use client";

import { useTranslations } from "next-intl";
import type { PlatformStats } from "./stats-constants";

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
