import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchProfile } from "../../auth/profile-client";
import { LogsView } from "./LogsView";
import { AdminPageShell } from "../AdminPageShell";

/**
 * Admin observability logs page — /admin/logs (GH #310, Slice 2).
 *
 * Server component that:
 *  1. Reads the session token from the kinora_session cookie.
 *  2. Resolves the profile via GET /auth/profile and redirects to `/` unless
 *     `isAdmin` — the SAME superadmin guard the /admin landing and
 *     /admin/tenants pages use, so a non-admin never sees this panel.
 *  3. Renders the client LogsView (filters → results table → load more).
 *
 * Layout follows the Open Design `web-admin-logs.html` screen
 * (kno/kInorA#414). The design's "6 errors in 24h" topbar pill is not
 * rendered: this route has no aggregate endpoint (kno/kInorA#411).
 */
export default async function AdminLogsPage() {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const profile = token ? await fetchProfile(token) : null;
  if (!profile || profile.isAdmin !== true) {
    redirect("/");
  }

  return (
    <AdminPageShell
      eyebrow={t("admin.sectionEyebrow")}
      title={t("logs.title")}
      description={t("logs.description")}
      backLabel={t("admin.pageTitle")}
    >
      <LogsView />
    </AdminPageShell>
  );
}
