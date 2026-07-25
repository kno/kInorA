"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type {
  BillingCycle,
  BillingPricingDTO,
  BillingVisibilityDTO,
  InvoiceDTO,
  TenantQuotaUsageDTO,
} from "@kinora/contracts";
import { useFormatter, useTranslations } from "next-intl";
import type { GetBillingInvoicesResult } from "./billing-types";
import {
  getBillingInvoicesAction,
  getBillingVisibilityAction,
  openPortalAction,
  startCheckoutAction,
} from "./actions";
import styles from "./BillingPageClient.module.css";

export interface BillingPageClientProps {
  initialData: BillingVisibilityDTO | null;
  initialError?: string | null;
  pricing: BillingPricingDTO | null;
  initialInvoices: GetBillingInvoicesResult;
}

const MS_PER_DAY = 86_400_000;

/** Redirect the browser to a Stripe-hosted URL. Extracted so it is easy to spy in tests. */
function redirectTo(url: string): void {
  window.location.assign(url);
}

export function BillingPageClient({
  initialData,
  initialError = null,
  pricing,
  initialInvoices,
}: BillingPageClientProps) {
  const t = useTranslations();
  const [data, setData] = useState<BillingVisibilityDTO | null>(initialData);
  const [error, setError] = useState<string | null>(initialError);
  const [invoices, setInvoices] = useState<GetBillingInvoicesResult>(initialInvoices);
  const [loading, setLoading] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  // FIX 3 (11a): collapse concurrent focus+visibilitychange activations into a
  // single refresh; requestId is a latest-wins guard against stale responses.
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
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);
    try {
      // Refresh billing state AND owner-only invoices together, so a tenant
      // switch that changes ownership can never keep the previous tenant's
      // invoices or owner-only actions on screen.
      const [visibility, invoiceResult] = await Promise.all([
        getBillingVisibilityAction(),
        getBillingInvoicesAction(),
      ]);
      if (requestId !== requestIdRef.current) return; // a newer refresh started — ignore
      if (visibility.kind === "ok") {
        setData(visibility.data);
        setError(null);
        setInvoices(invoiceResult);
      } else {
        console.error({ event: "billing_visibility_refresh_failed", kind: visibility.message });
        setError(visibility.message);
      }
    } finally {
      inFlightRef.current = false;
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

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

  // A definitive 403 (forbidden) proves the caller is NOT an owner. Any other
  // outcome (ok, or a transient error) is treated as owner, so owner-only UI is
  // hidden ONLY when we are certain the member lacks ownership.
  const isOwner = invoices.kind !== "forbidden";

  return (
    <BillingScreen
      data={data}
      pricing={pricing}
      invoices={invoices}
      isOwner={isOwner}
    />
  );
}

function BillingScreen({
  data,
  pricing,
  invoices,
  isOwner,
}: {
  data: BillingVisibilityDTO;
  pricing: BillingPricingDTO | null;
  invoices: GetBillingInvoicesResult;
  isOwner: boolean;
}) {
  const t = useTranslations();
  const { billing, tenantUsage, memberUsage, denialReason } = data;

  const isActiveUnexpiredTrial =
    billing.status === "trialing" &&
    denialReason !== "trial_expired" &&
    billing.trialEndsAt !== null &&
    new Date(billing.trialEndsAt).getTime() > Date.now();
  const trialDaysRemaining = isActiveUnexpiredTrial
    ? Math.max(0, Math.ceil((new Date(billing.trialEndsAt!).getTime() - Date.now()) / MS_PER_DAY))
    : null;

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div>
          <h1 className="kin-title">{t("billing.title")}</h1>
          <p className="kin-text kin-muted">{t("billing.subtitle")}</p>
        </div>
        <div className={styles.chips}>
          {/* data-testid: stable e2e/component targets — the tier word ("Pro")
              also renders as the PlanHero title below, so `getByText("Pro")`
              alone is ambiguous (Playwright strict-mode). Prefer these testids
              over text locators for tier/status/trial (see
              tests/e2e/billing-visibility.spec.ts). */}
          <span className={styles.tierChip} data-testid="billing-tier-chip">
            {t(`billing.tier.${billing.tier}`)}
          </span>
          <span className={styles.statusChip} data-testid="billing-status-chip">
            {t(`billing.status.${billing.status}`)}
          </span>
          {trialDaysRemaining !== null ? (
            <span className={styles.trialChip} data-testid="billing-trial-badge">
              {t("billing.trial.badge", { daysRemaining: trialDaysRemaining })}
            </span>
          ) : null}
        </div>
      </header>

      <div className={styles.grid}>
        <div role="region" aria-label={t("billing.regions.main")} className={styles.mainCol}>
          <PlanHero
            billing={billing}
            pricing={pricing}
            period={tenantUsage[0]?.period ?? memberUsage[0]?.period ?? null}
          />
          <UsageMeters tenantUsage={tenantUsage} memberUsage={memberUsage} />
          {isOwner ? <InvoiceHistory invoices={invoices} /> : null}
        </div>

        <aside aria-label={t("billing.regions.aside")} className={styles.asideCol}>
          <ProCard billing={billing} pricing={pricing} />
          {isOwner ? <PaymentCard /> : null}
          <SupportCard />
        </aside>
      </div>
    </div>
  );
}

function PlanHero({
  billing,
  pricing,
  period,
}: {
  billing: BillingVisibilityDTO["billing"];
  pricing: BillingPricingDTO | null;
  /** The current billing period key (e.g. "2026-07"), sourced from a usage
   * row — the SAME period the Usage Meters section reports on below. Kept as
   * a distinct signal from `currentPeriodEnd` (a renewal DATE) so the
   * "Current period" tile never collapses into the "Renewal" tile. */
  period: string | null;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const isPro = billing.tier === "pro";
  const renewal =
    billing.currentPeriodEnd != null
      ? new Date(billing.currentPeriodEnd).toISOString().slice(0, 10)
      : t("billing.plan.renewalNone");

  // FIX 1 (4R review): the Price tile must show the actual formatted price for
  // the tenant's cycle — NOT the cycle label (the cycle toggle already shows
  // that in the Pro card, and reusing it here duplicated the Current-period
  // tile below). Pro without a resolvable cycle/price falls back to a plain
  // placeholder rather than duplicating any other tile's content.
  const priceForCycle =
    isPro && billing.billingCycle && pricing ? pricing[billing.billingCycle] : null;
  const priceValue = !isPro
    ? t("billing.plan.priceFree")
    : priceForCycle
      ? format.number(priceForCycle.amountPerMonth / 100, {
          style: "currency",
          currency: pricing!.currency,
        })
      : t("billing.plan.valueNotSet");

  // FIX 1 (4R review): "Current period" must reflect the REAL current billing
  // period (the same period key the Usage Meters section reports on) — NOT
  // the cycle label, and NOT a restatement of the Renewal date tile above.
  const currentPeriodValue =
    period ??
    (billing.status === "trialing" && billing.trialEndsAt != null
      ? t("billing.plan.periodTrialEndsOn", {
          date: new Date(billing.trialEndsAt).toISOString().slice(0, 10),
        })
      : t("billing.plan.valueNotSet"));

  return (
    <section className={styles.card} data-testid="billing-plan-hero">
      <span className={styles.eyebrow}>{t("billing.plan.currentLabel")}</span>
      <h2 className={styles.planName}>{t(`billing.tier.${billing.tier}`)}</h2>
      <p className="kin-text kin-muted">
        {isPro ? t("billing.plan.descriptionPro") : t("billing.plan.descriptionFree")}
      </p>
      <dl className={styles.metaGrid}>
        <MetaTile label={t("billing.plan.metaPrice")} value={priceValue} />
        <MetaTile label={t("billing.plan.metaRenewal")} value={renewal} />
        <MetaTile label={t("billing.plan.metaPeriod")} value={currentPeriodValue} />
        <MetaTile
          label={t("billing.plan.metaPayment")}
          value={isPro ? t("billing.pro.title") : t("billing.plan.valueNotSet")}
        />
      </dl>
    </section>
  );
}

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaTile}>
      <dt className={styles.metaLabel}>{label}</dt>
      <dd className={styles.metaValue}>{value}</dd>
    </div>
  );
}

function UsageMeters({
  tenantUsage,
  memberUsage,
}: {
  tenantUsage: TenantQuotaUsageDTO[];
  memberUsage: BillingVisibilityDTO["memberUsage"];
}) {
  const t = useTranslations();
  const isEmpty = tenantUsage.length === 0 && memberUsage.length === 0;

  if (isEmpty) {
    return (
      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{t("billing.usage.tenantTitle")}</h3>
        <p className="kin-text kin-muted">{t("billing.usage.emptyTitle")}</p>
        <p className="kin-text kin-muted">{t("billing.usage.emptyDescription")}</p>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>{t("billing.usage.tenantTitle")}</h3>
      <ul className={styles.meterList} aria-label={t("billing.usage.tenantTitle")}>
        {tenantUsage.map((row) => (
          <Meter key={`tenant-${row.feature}`} feature={row.feature} used={row.used} limit={row.limit} period={row.period} />
        ))}
      </ul>
      {memberUsage.length > 0 ? (
        <>
          <h3 className={styles.cardTitle}>{t("billing.usage.memberTitle")}</h3>
          <ul className={styles.meterList} aria-label={t("billing.usage.memberTitle")}>
            {memberUsage.map((row) => (
              <Meter key={`member-${row.feature}`} feature={row.feature} used={row.used} limit={row.limit} period={row.period} />
            ))}
          </ul>
        </>
      ) : null}
      <p className={styles.usageFooter}>{t("billing.usage.footer")}</p>
    </section>
  );
}

function Meter({
  feature,
  used,
  limit,
  period,
}: {
  feature: string;
  used: number;
  limit: number;
  period: string;
}) {
  const t = useTranslations();
  const featureLabel = t(`billing.feature.${feature}`);
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <li className={styles.meterRow}>
      <div className={styles.meterHead}>
        <span className={styles.meterLabel}>{featureLabel}</span>
        <span className={styles.meterValue}>{`${used}/${limit}`}</span>
      </div>
      <div
        role="meter"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={t("billing.usage.meterAria", { feature: featureLabel, used, limit })}
        className={styles.meterTrack}
      >
        <span className={styles.meterFill} style={{ width: `${percent}%` }} />
      </div>
      <div className={styles.meterNotes}>
        {/* Metered copy — NEVER "unlimited": the enforcement path denies over-cap
            requests, so the UI states the concrete monthly cap. */}
        <span className={styles.meterNote}>{t("billing.usage.limitNote", { limit })}</span>
        <span className={styles.meterNote}>{t("billing.usage.periodLabel", { period })}</span>
      </div>
    </li>
  );
}

function InvoiceHistory({ invoices }: { invoices: GetBillingInvoicesResult }) {
  const t = useTranslations();
  const format = useFormatter();

  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>{t("billing.history.title")}</h3>
      {invoices.kind === "error" ? (
        <>
          <p className="kin-text">{t("billing.history.errorTitle")}</p>
          <p className="kin-text kin-muted">{t("billing.history.errorDescription")}</p>
        </>
      ) : invoices.kind === "ok" && invoices.invoices.length > 0 ? (
        <ul className={styles.invoiceList} aria-label={t("billing.history.title")}>
          {invoices.invoices.map((invoice) => (
            <InvoiceRow key={invoice.id} invoice={invoice} format={format} />
          ))}
        </ul>
      ) : (
        <>
          <p className="kin-text">{t("billing.history.empty")}</p>
          <p className="kin-text kin-muted">{t("billing.history.emptyDescription")}</p>
        </>
      )}
    </section>
  );
}

function InvoiceRow({
  invoice,
  format,
}: {
  invoice: InvoiceDTO;
  format: ReturnType<typeof useFormatter>;
}) {
  const t = useTranslations();
  const date = new Date(invoice.createdAt).toISOString().slice(0, 10);
  const amount = format.number(invoice.amountDue / 100, {
    style: "currency",
    currency: invoice.currency,
  });
  const receiptHref = invoice.receiptUrl ?? invoice.hostedInvoiceUrl;

  return (
    <li className={styles.invoiceRow}>
      <div>
        <span className={styles.invoiceDate}>{date}</span>
        <span className={styles.invoiceStatus}>{invoice.status}</span>
      </div>
      <div className={styles.invoiceRight}>
        <span className={styles.invoiceAmount}>{amount}</span>
        {receiptHref ? (
          <a
            className={styles.receiptLink}
            href={receiptHref}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t("billing.history.invoiceAria", {
              date,
              amount,
              status: invoice.status,
            })}
          >
            {t("billing.history.download")}
          </a>
        ) : null}
      </div>
    </li>
  );
}

function ProCard({
  billing,
  pricing,
}: {
  billing: BillingVisibilityDTO["billing"];
  pricing: BillingPricingDTO | null;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [busy, setBusy] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);

  const isCurrentPro = billing.tier === "pro" && billing.status === "active";

  async function onUpgrade() {
    setBusy(true);
    setCtaError(null);
    try {
      const result = await startCheckoutAction(cycle, undefined);
      if (result.kind === "ok") {
        redirectTo(result.url);
        return;
      }
      setCtaError(
        result.message === "invalid_promotion_code"
          ? t("billing.actions.invalidPromotion")
          : t("billing.actions.checkoutError"),
      );
    } finally {
      setBusy(false);
    }
  }

  const priceForCycle = pricing ? pricing[cycle] : null;

  return (
    <section className={`${styles.card} ${styles.proCard}`}>
      <span className={styles.eyebrow}>{t("billing.pro.eyebrow")}</span>
      <h3 className={styles.cardTitle}>{t("billing.pro.title")}</h3>

      <div role="radiogroup" aria-label={t("billing.pro.cycleAria")} className={styles.cycleToggle}>
        <CycleOption
          label={t("billing.pro.cycleMonthly")}
          selected={cycle === "monthly"}
          onSelect={() => setCycle("monthly")}
        />
        <CycleOption
          label={t("billing.pro.cycleAnnual")}
          selected={cycle === "annual"}
          onSelect={() => setCycle("annual")}
        />
      </div>

      {priceForCycle && pricing ? (
        <div className={styles.priceBlock}>
          <span className={styles.price}>
            {format.number(priceForCycle.amountPerMonth / 100, {
              style: "currency",
              currency: pricing.currency,
            })}
          </span>
          <span className={styles.priceSuffix}>{t("billing.pro.priceSuffix")}</span>
          {pricing.annualSavePercent > 0 ? (
            <span className={styles.saveBadge}>
              {t("billing.pro.saveBadge", { percent: pricing.annualSavePercent })}
            </span>
          ) : null}
          {cycle === "annual" ? (
            <span className={styles.annualNote}>{t("billing.pro.annualBilled")}</span>
          ) : null}
        </div>
      ) : null}

      <ul className={styles.benefits}>
        <li>{t("billing.pro.benefitGenerations")}</li>
        <li>{t("billing.pro.benefitMemory")}</li>
        <li>{t("billing.pro.benefitSupport")}</li>
      </ul>

      {isCurrentPro ? (
        <p className={styles.currentBadge}>{t("billing.pro.currentBadge")}</p>
      ) : (
        <button
          type="button"
          className="kin-btn kin-btn--primary"
          onClick={() => void onUpgrade()}
          disabled={busy}
        >
          {busy ? t("billing.actions.redirecting") : t("billing.pro.cta")}
        </button>
      )}

      {ctaError ? (
        <p role="alert" className={styles.ctaError}>
          {ctaError}
        </p>
      ) : null}

      <p className="kin-text kin-muted">{t("billing.pro.noCommitment")}</p>
    </section>
  );
}

function CycleOption({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`${styles.cycleOption} ${selected ? styles.cycleOptionActive : ""}`}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

function PaymentCard() {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  async function onManage() {
    setBusy(true);
    setPortalError(null);
    try {
      const result = await openPortalAction();
      if (result.kind === "ok") {
        redirectTo(result.url);
        return;
      }
      setPortalError(t("billing.actions.portalError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>{t("billing.payment.title")}</h3>
      <p className="kin-text kin-muted">{t("billing.payment.description")}</p>
      <button
        type="button"
        className="kin-btn kin-btn--secondary"
        onClick={() => void onManage()}
        disabled={busy}
      >
        {busy ? t("billing.actions.redirecting") : t("billing.payment.manageCta")}
      </button>
      {portalError ? (
        <p role="alert" className={styles.ctaError}>
          {portalError}
        </p>
      ) : null}
    </section>
  );
}

function SupportCard() {
  const t = useTranslations();
  return (
    <section className={styles.card}>
      <h3 className={styles.cardTitle}>{t("billing.support.title")}</h3>
      <p className="kin-text kin-muted">{t("billing.support.description")}</p>
      {/*
       * FIX 2 (4R review, SUGGESTION): no `/help/billing` route exists in
       * apps/web yet — linking there would 404 on click. Until a real support
       * destination exists, render this as a NON-navigating disabled affordance
       * (aria-disabled, no href) rather than ship a dead link. Swap back to a
       * real <a href> once a billing FAQ/support destination is added.
       * TODO(11b-followup): point at the real billing FAQ/support URL.
       */}
      <span className={styles.supportLink} aria-disabled="true" role="link">
        {t("billing.support.faqCta")}
      </span>
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
