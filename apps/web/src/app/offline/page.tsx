import React from "react";
import { getFirstParam, resolvePageI18n } from "@/i18n/request";

/**
 * Offline fallback page — shown by the service worker when the user
 * navigates without a network connection.
 *
 * Uses `kin-*` design token classes from globals.css instead of
 * inline styles.
 *
 * User-facing copy comes from the i18n catalogs (see `@/i18n/locale`),
 * resolved from the `?lang=` query parameter or the `Accept-Language` header.
 */
export default async function OfflinePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const { messages } = await resolvePageI18n(getFirstParam(params.lang));

  return (
    <div className="kin-offline">
      <div className="kin-offline__card">
        <h1 className="kin-offline__title">{messages.offline_title}</h1>
        <p className="kin-offline__text">{messages.offline_description}</p>
        <div className="kin-card">
          <p className="kin-offline__text">{messages.offline_sync_note}</p>
        </div>
      </div>
    </div>
  );
}
