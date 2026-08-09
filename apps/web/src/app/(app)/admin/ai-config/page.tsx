import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchAiConfig } from "./ai-config-client";
import { AiConfigForm } from "./AiConfigForm";
import type { AiProvider } from "./ai-config-client";
import { AdminPageShell } from "../AdminPageShell";
import styles from "../admin.module.css";

/**
 * AI Provider Admin Config page — /admin/ai-config
 *
 * Server component that:
 *  1. Reads the session token from the kinora_session cookie
 *  2. Fetches the current AI provider config from GET /admin/ai-config
 *  3. If the API returns 403 (not admin) → redirect to /  (SC-13, T9)
 *  4. Renders AiConfigForm with the current config (SC-14)
 *
 * API keys are NEVER shown in this panel — only provider + model.
 *
 * Layout follows the Open Design `web-admin-ai-config.html` screen
 * (kno/kInorA#414): form on the left, an API-keys notice and a server-side
 * summary aside. The design's "last updated / updated by" rows and its
 * per-variable "defined / not defined" list are deliberately NOT rendered —
 * the API exposes neither, and inventing them would be design copy shipped as
 * data (kno/kInorA#411). The keys panel keeps the warning without claiming to
 * know which environment variables are set.
 */
export default async function AiConfigPage() {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const result = await fetchAiConfig(token);

  // SC-13 / T9: non-admin (403) OR unauthenticated (401) → redirect to home.
  // Never render the admin panel UI to a user the API would not authorize.
  if (result.kind === "forbidden" || result.kind === "unauthorized") {
    redirect("/");
  }

  // A read failure here is distinct from "no config saved yet" (`config: null`
  // on an `ok` result). Collapsing both into `null` used to let an admin hit
  // Save believing an empty form reflected reality and overwrite a real
  // provider/model setting — see kno/kInorA#378. `loadFailed` drives both the
  // visible error banner and the AiConfigForm save guard below.
  const loadFailed = result.kind === "error";
  const config = result.kind === "ok" ? result.config : null;

  return (
    <AdminPageShell
      eyebrow={t("admin.sectionEyebrow")}
      title={t("admin.sections.aiConfig.title")}
      description={t("admin.sections.aiConfig.description")}
      backLabel={t("admin.pageTitle")}
    >
      {loadFailed && (
        <p
          className={`${styles.banner} ${styles.bannerDanger}`}
          role="alert"
          data-testid="ai-config-error"
        >
          {t("aiConfig.errors.loadFailed")}
        </p>
      )}

      <div className={styles.config}>
        <AiConfigForm
          initialProvider={config?.provider as AiProvider | undefined}
          initialModel={config?.model}
          loadFailed={loadFailed}
        />

        <aside className={styles.aside}>
          <section className={`${styles.panel} ${styles.keys}`} aria-labelledby="keys-title">
            <div className={styles.keysTop}>
              <span className={styles.keysIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="8" cy="14" r="4.2" />
                  <path d="M11.2 11.2 19 3.4M16.4 6.2l2.2 2.2M14.2 8.4l2.2 2.2" />
                </svg>
              </span>
              <div>
                <h2 id="keys-title">{t("aiConfig.keysTitle")}</h2>
                <p>{t("aiConfig.keysLead")}</p>
              </div>
            </div>
            <p>{t("aiConfig.keysBody")}</p>
          </section>

          <section className={`${styles.panel} ${styles.summary}`} aria-labelledby="summary-title">
            <h2 id="summary-title">{t("aiConfig.summaryTitle")}</h2>
            <div>
              <div className={styles.kv}>
                <span>{t("aiConfig.providerLabel")}</span>
                <strong data-testid="ai-config-summary-provider">{config?.provider ?? "—"}</strong>
              </div>
              <div className={styles.kv}>
                <span>{t("aiConfig.modelLabel")}</span>
                <strong data-testid="ai-config-summary-model">{config?.model ?? "—"}</strong>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </AdminPageShell>
  );
}
