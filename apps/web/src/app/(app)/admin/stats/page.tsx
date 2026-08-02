import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchProfile } from "../../auth/profile-client";
import { fetchStats } from "./stats-client";
import { StatsView } from "./StatsView";

/**
 * Admin platform-statistics page — /admin/stats (GH #309).
 *
 * Server component that:
 *  1. Reads the session token from the kinora_session cookie.
 *  2. Resolves the profile via GET /auth/profile and redirects to `/` unless
 *     `isAdmin` — the SAME superadmin guard the /admin landing, /admin/tenants
 *     and /admin/logs pages use, so a non-admin never sees this panel.
 *  3. Fetches the cross-tenant aggregates server-side and renders the read-only
 *     StatsView, or a localized error message on any non-ok result.
 */
export default async function AdminStatsPage() {
  const t = await getTranslations("platformStats");
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const profile = token ? await fetchProfile(token) : null;
  if (!profile || profile.isAdmin !== true) {
    redirect("/");
  }

  const result = await fetchStats(token);

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{t("title")}</h1>
        <p className="kin-text kin-muted" style={{ marginBottom: "1.5rem" }}>
          {t("description")}
        </p>
        {result.kind === "ok" ? (
          <StatsView stats={result.stats} />
        ) : (
          <p className="kin-text" role="alert" data-testid="stats-error">
            {t("error")}
          </p>
        )}
      </div>
    </main>
  );
}
