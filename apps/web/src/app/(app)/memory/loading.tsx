"use client";

import { useTranslations } from "next-intl";

export default function MemoryLoading() {
  const t = useTranslations();

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <div role="status" aria-live="polite" className="kin-text">
          <div role="progressbar" aria-busy="true" aria-label={t("memory.loading.progressAria")} />
          <h1 className="kin-title" style={{ marginTop: "1rem" }}>
            {t("memory.loading.title")}
          </h1>
          <p className="kin-text kin-muted">{t("memory.loading.description")}</p>
        </div>
      </div>
    </main>
  );
}
