import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchProfile } from "../../auth/profile-client";
import { TenantProvisioningForm } from "./TenantProvisioningForm";
import { AdminPageShell } from "../AdminPageShell";

/**
 * Tenant Provisioning admin page — /admin/tenants (GH #307, search-by-name).
 *
 * Server component that:
 *  1. Reads the session token from the kinora_session cookie.
 *  2. Resolves the profile via GET /auth/profile and redirects to `/` unless
 *     `isAdmin` — the SAME superadmin guard the /admin landing page uses, so a
 *     non-admin never sees this panel.
 *  3. Renders the client form (search → select → grant/revoke).
 *
 * Layout follows the Open Design `web-admin-tenants.html` screen
 * (kno/kInorA#414). The design's topbar count pill ("128 organizations · 16
 * with override") is not rendered: this route has no aggregate endpoint, and a
 * figure with nothing behind it is the defect kno/kInorA#411 was raised for.
 */
export default async function TenantProvisioningPage() {
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
      title={t("tenantProvisioning.title")}
      description={t("tenantProvisioning.description")}
      backLabel={t("admin.pageTitle")}
    >
      <TenantProvisioningForm />
    </AdminPageShell>
  );
}
