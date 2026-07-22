"use client";

import { useTranslations } from "next-intl";
import { OrbitProgress } from "@/components/orbit";

export default function ProfileLoading() {
  const t = useTranslations();

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <div role="status" aria-live="polite" className="kin-text">
          <OrbitProgress
            indeterminate
            size={96}
            aria-label={t("profile.loading.progressAria")}
          />
          <h1 className="kin-title" style={{ marginTop: "1rem" }}>
            {t("profile.loading.title")}
          </h1>
          <p className="kin-text kin-muted">{t("profile.loading.description")}</p>
        </div>
      </div>
    </main>
  );
}
