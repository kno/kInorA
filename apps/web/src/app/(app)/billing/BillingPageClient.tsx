"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { BillingVisibilityDTO } from "@kinora/contracts";
import { useTranslations } from "next-intl";
import { getBillingVisibilityAction } from "./actions";

export interface BillingPageClientProps {
  initialData: BillingVisibilityDTO | null;
  initialError?: string | null;
}

const MS_PER_DAY = 86_400_000;

export function BillingPageClient({ initialData, initialError = null }: BillingPageClientProps) {
  const t = useTranslations();
  const [data, setData] = useState<BillingVisibilityDTO | null>(initialData);
  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  // FIX 3 (review correction): `focus` and `visibilitychange` fire together
  // on a real tab activation — without a guard, both listeners call
  // `refresh()` concurrently (a "storm" on rapid toggling). `inFlightRef`
  // collapses any activation while a refresh is already pending into a
  // no-op; `requestIdRef` is a belt-and-suspenders "latest wins" guard so a
  // stale in-flight response (if one were ever started despite the guard)
  // can never overwrite a newer one.
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);

  const isOfflineState = !data && error === "api_unreachable" && !online;
  const isErrorState = !data && !!error && !isOfflineState;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if ((isOfflineState || isErrorState) && retryButtonRef.current) {
      retryButtonRef.current.focus();
    }
  }, [isErrorState, isOfflineState]);

  async function refresh() {
    if (inFlightRef.current) return; // collapse a concurrent activation into a no-op
    inFlightRef.current = true;
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);
    try {
      const result = await getBillingVisibilityAction();
      if (requestId !== requestIdRef.current) return; // a newer refresh has since started — ignore this stale response
      if (result.kind === "ok") {
        // REPLACE, never merge, so a tenant switch shows only the new
        // tenant's billing state (spec: "Tenant switching refreshes billing").
        setData(result.data);
        setError(null);
      } else {
        // #176 — a failed client refetch must be observable, not silently
        // swallowed. Structured event + failure kind only; never any token or
        // response content (the Result carries only an error kind string).
        console.error({ event: "billing_visibility_refresh_failed", kind: result.message });
        setError(result.message);
      }
    } finally {
      inFlightRef.current = false;
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  // Refresh on tab focus/visibility so a tenant switch (which issues a new
  // session bound to the newly active tenant) is picked up without a full
  // reload. The Server Action always reads the CURRENT session cookie, so
  // this can only ever surface the caller's own current tenant.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleFocus = () => {
      void refresh();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading && !data) {
    return <BillingLoadingState />;
  }

  if (isOfflineState) {
    return (
      <BillingStatusCard
        title={t("billing.states.offlineTitle")}
        description={t("billing.states.offlineDescription")}
        retryRef={retryButtonRef}
        onRetry={() => void refresh()}
      />
    );
  }

  if (isErrorState) {
    return (
      <BillingStatusCard
        title={t("billing.states.errorTitle")}
        description={t("billing.states.errorDescription")}
        retryRef={retryButtonRef}
        onRetry={() => void refresh()}
      />
    );
  }

  if (!data) {
    return (
      <section className="kin-card kin-card--center" style={{ maxWidth: 640 }}>
        <h2 className="kin-title">{t("billing.states.emptyTitle")}</h2>
        <p className="kin-text kin-muted">{t("billing.states.emptyDescription")}</p>
      </section>
    );
  }

  const { billing, tenantUsage, memberUsage, denialReason, upgradePromptPath } = data;
  const isUsageEmpty = tenantUsage.length === 0 && memberUsage.length === 0;
  // FIX 2 (review correction): the STORED billing.status stays 'trialing'
  // even after trialEndsAt lapses — only the dynamically resolved tier and
  // denialReason ('trial_expired') reflect expiry. Gate the badge on an
  // ACTIVE, UNEXPIRED trial (status trialing + trialEndsAt strictly in the
  // future + no trial_expired denial) so the badge and the "trial ended"
  // block are never shown together.
  const isActiveUnexpiredTrial =
    billing.status === "trialing" &&
    denialReason !== "trial_expired" &&
    billing.trialEndsAt !== null &&
    new Date(billing.trialEndsAt).getTime() > Date.now();
  const trialDaysRemaining = isActiveUnexpiredTrial
    ? Math.max(0, Math.ceil((new Date(billing.trialEndsAt!).getTime() - Date.now()) / MS_PER_DAY))
    : null;

  return (
    <section className="kin-card kin-card--center" style={{ maxWidth: 760 }}>
      <h2 className="kin-title">{t("billing.title")}</h2>

      <div
        style={{
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          flexWrap: "wrap",
          margin: "1rem 0",
        }}
      >
        <span className="kin-text" style={{ fontWeight: 600 }}>
          {t(`billing.tier.${billing.tier}`)}
        </span>
        <span className="kin-text kin-muted">{t(`billing.status.${billing.status}`)}</span>
        {trialDaysRemaining !== null ? (
          <span className="kin-text kin-muted">
            {t("billing.trial.badge", { daysRemaining: trialDaysRemaining })}
          </span>
        ) : null}
      </div>

      {denialReason === "trial_expired" ? (
        <div className="kin-card" style={{ marginBottom: "1rem" }}>
          <h3 className="kin-title" style={{ fontSize: "1rem" }}>
            {t("billing.trial.expiredTitle")}
          </h3>
          <p className="kin-text kin-muted">{t("billing.trial.expiredDescription")}</p>
        </div>
      ) : null}

      {denialReason && upgradePromptPath ? (
        <div className="kin-card" style={{ marginBottom: "1rem" }}>
          <h3 className="kin-title" style={{ fontSize: "1rem" }}>
            {t("billing.upgrade.title")}
          </h3>
          <p className="kin-text kin-muted">{t("billing.upgrade.description")}</p>
          <a className="kin-btn kin-btn--primary" href={upgradePromptPath}>
            {t("billing.upgrade.cta")}
          </a>
        </div>
      ) : null}

      {isUsageEmpty ? (
        <div className="kin-card" style={{ width: "100%" }}>
          <h3 className="kin-title" style={{ fontSize: "1.125rem" }}>
            {t("billing.usage.emptyTitle")}
          </h3>
          <p className="kin-text kin-muted">{t("billing.usage.emptyDescription")}</p>
        </div>
      ) : (
        <>
          <div className="kin-card" style={{ width: "100%", marginBottom: "1rem" }}>
            <h3 className="kin-title" style={{ fontSize: "1.125rem" }}>
              {t("billing.usage.tenantTitle")}
            </h3>
            <ul aria-label={t("billing.usage.tenantTitle")} style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {tenantUsage.map((row) => (
                <li key={row.feature} className="kin-text">
                  {t("billing.usage.row", {
                    feature: t(`billing.feature.${row.feature}`),
                    used: row.used,
                    limit: row.limit,
                  })}
                </li>
              ))}
            </ul>
          </div>
          <div className="kin-card" style={{ width: "100%" }}>
            <h3 className="kin-title" style={{ fontSize: "1.125rem" }}>
              {t("billing.usage.memberTitle")}
            </h3>
            <ul aria-label={t("billing.usage.memberTitle")} style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {memberUsage.map((row) => (
                <li key={row.feature} className="kin-text">
                  {t("billing.usage.row", {
                    feature: t(`billing.feature.${row.feature}`),
                    used: row.used,
                    limit: row.limit,
                  })}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

function BillingStatusCard({
  title,
  description,
  onRetry,
  retryRef,
}: {
  title: string;
  description: string;
  onRetry: () => void;
  retryRef: RefObject<HTMLButtonElement | null>;
}) {
  const t = useTranslations();

  return (
    <section className="kin-card kin-card--center" style={{ maxWidth: 640 }}>
      <h2 className="kin-title">{title}</h2>
      <p className="kin-text kin-muted">{description}</p>
      <button ref={retryRef} type="button" className="kin-btn kin-btn--primary" onClick={onRetry}>
        {t("billing.states.retry")}
      </button>
    </section>
  );
}

function BillingLoadingState() {
  const t = useTranslations();

  return (
    <section className="kin-card kin-card--center" style={{ maxWidth: 640 }}>
      <div role="status" aria-live="polite" className="kin-text">
        <div role="progressbar" aria-busy="true" aria-label={t("billing.loading.progressAria")} />
        <h2 className="kin-title" style={{ marginTop: "1rem" }}>
          {t("billing.loading.title")}
        </h2>
        <p className="kin-text kin-muted">{t("billing.loading.description")}</p>
      </div>
    </section>
  );
}
