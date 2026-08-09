import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchProfile } from "../../auth/profile-client";
import { LogsView } from "./LogsView";

/**
 * Admin observability logs page — /admin/logs (GH #310, Slice 2).
 *
 * Server component that:
 *  1. Reads the session token from the kinora_session cookie.
 *  2. Resolves the profile via GET /auth/profile and redirects to `/` unless
 *     `isAdmin` — the SAME superadmin guard the /admin landing and
 *     /admin/tenants pages use, so a non-admin never sees this panel.
 *  3. Renders the client LogsView (filters → results table → load more).
 */
export default async function AdminLogsPage() {
  const t = await getTranslations("logs");
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const profile = token ? await fetchProfile(token) : null;
  if (!profile || profile.isAdmin !== true) {
    redirect("/");
  }

  return (
    <main className="kin-page">
      <div className="kin-stack kin-stack--center">
        <h1 className="kin-title">{t("title")}</h1>
        <p className="kin-text kin-muted" style={{ marginBottom: "1.5rem" }}>
          {t("description")}
        </p>
        <LogsView />
      </div>
    </main>
  );
}
