import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchUserProfile } from "./profile-form-client";
import { ProfileForm } from "./ProfileForm";

/**
 * Profile page (/profile) — authenticated, rendered inside the AppShell.
 *
 * Server component that:
 *   1. Reads the session token from the `kinora_session` cookie.
 *   2. Fetches the profile via `GET /user-profile` (server-to-server; the
 *      lazy-provisioning endpoint always returns 200 for an authenticated
 *      user, so the form is seeded with the real values on first paint).
 *   3. Renders `ProfileForm` with the loaded profile — or an `initialError`
 *      flag so the form can show a load-error state on a network/auth failure.
 *
 * User-facing copy comes from next-intl; the locale is resolved from the
 * `x-kinora-lang` header (proxy) or `Accept-Language`.
 */
export default async function ProfilePage() {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const result = await fetchUserProfile(token);
  const initialProfile = result.kind === "ok" ? result.profile : null;
  const initialError = result.kind === "error" ? result.message : null;

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">{t("profile.title")}</h1>
        <p className="kin-text kin-muted" style={{ marginBottom: "1.5rem" }}>
          {t("profile.description")}
        </p>
        <ProfileForm initialProfile={initialProfile} initialError={initialError} />
      </div>
    </main>
  );
}