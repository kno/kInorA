import React from "react";
import { getTranslations } from "next-intl/server";

/**
 * Offline fallback page — shown by the service worker when the user
 * navigates without a network connection.
 *
 * Uses `kin-*` design token classes from globals.css instead of
 * inline styles.
 *
 * User-facing copy comes from next-intl (see `@/i18n/request`), whose
 * locale is resolved from the `?lang=` query parameter (via the
 * `x-kinora-lang` header injected by `proxy.ts`) or the `Accept-Language`
 * header. This page is precached by Serwist for offline use — its markup
 * (and the locale resolved at precache time) is served verbatim while
 * offline, so it does not re-resolve locale client-side.
 */
export default async function OfflinePage() {
  const t = await getTranslations();

  return (
    <div className="kin-offline">
      <div className="kin-offline__card">
        <h1 className="kin-offline__title">{t("offline.title")}</h1>
        <p className="kin-offline__text">{t("offline.description")}</p>
        <div className="kin-card">
          <p className="kin-offline__text">{t("offline.syncNote")}</p>
        </div>
      </div>
    </div>
  );
}
