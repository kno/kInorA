import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Billing help / FAQ page (/help/billing) — authenticated, rendered inside the
 * AppShell. A minimal, static server component: the billing screen's Support
 * card links here (#199) instead of a dead placeholder, so the FAQ is a real
 * reachable destination. Copy comes from next-intl; the locale is resolved by
 * the request pipeline (proxy `x-kinora-lang` / `Accept-Language`).
 */
export default async function BillingHelpPage() {
  const t = await getTranslations();

  const faqs = [
    { q: t("billing.help.faq.upgradeQuestion"), a: t("billing.help.faq.upgradeAnswer") },
    { q: t("billing.help.faq.manageQuestion"), a: t("billing.help.faq.manageAnswer") },
    { q: t("billing.help.faq.invoiceQuestion"), a: t("billing.help.faq.invoiceAnswer") },
    { q: t("billing.help.faq.endedQuestion"), a: t("billing.help.faq.endedAnswer") },
  ];

  return (
    <main className="kin-page">
      <div className="kin-card" style={{ maxWidth: 720, marginInline: "auto" }}>
        <h1 className="kin-title">{t("billing.help.title")}</h1>
        <p className="kin-text kin-muted" style={{ marginBottom: "1.5rem" }}>
          {t("billing.help.intro")}
        </p>

        <dl>
          {faqs.map((faq) => (
            <div key={faq.q} style={{ marginBottom: "1.25rem" }}>
              <dt className="kin-text" style={{ fontWeight: 600 }}>
                {faq.q}
              </dt>
              <dd className="kin-text kin-muted" style={{ margin: 0 }}>
                {faq.a}
              </dd>
            </div>
          ))}
        </dl>

        <Link className="kin-btn kin-btn--secondary" href="/billing">
          {t("billing.help.backToBilling")}
        </Link>
      </div>
    </main>
  );
}
