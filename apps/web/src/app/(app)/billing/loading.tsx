"use client";

import { useTranslations } from "next-intl";

export default function BillingLoading() {
  const t = useTranslations();

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <div role="status" aria-live="polite" className="kin-text">
          <div role="progressbar" aria-busy="true" aria-label={t("billing.loading.progressAria")} />
          <h1 className="kin-title" style={{ marginTop: "1rem" }}>
            {t("billing.loading.title")}
          </h1>
          <p className="kin-text kin-muted">{t("billing.loading.description")}</p>
        </div>
      </div>
    </main>
  );
}
