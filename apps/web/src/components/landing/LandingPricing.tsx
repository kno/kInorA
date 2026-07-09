import { getTranslations } from "next-intl/server";
import { KinIcon } from "@/components/icons";
import { OrbitCard, OrbitSectionHeader } from "@/components/orbit";
import { Reveal } from "./Reveal";

/** Monthly price in EUR for the Pro tier. */
const PRO_PRICE_EUR = "9";
/** Monthly price in EUR for the Teams tier. */
const TEAM_PRICE_EUR = "29";

interface PricingTier {
  tier: string;
  desc: string;
  amount: string;
  per: string;
  /** Destination href for the CTA link. Driven by data, never by copy text. */
  href: string;
  features: { label: string; muted?: boolean }[];
  cta: string;
  pro?: boolean;
  badge?: string;
  currency?: string;
}

export async function LandingPricing() {
  const t = await getTranslations();

  const tiers: PricingTier[] = [
    {
      tier: t("pricing.free.tier"),
      desc: t("pricing.free.desc"),
      amount: t("pricing.free.amount"),
      per: t("pricing.free.per"),
      currency: "€",
      href: "/sign-up",
      features: [
        { label: t("pricing.free.feat1") },
        { label: t("pricing.free.feat2") },
        { label: t("pricing.free.feat3") },
        { label: t("pricing.free.feat4"), muted: true },
      ],
      cta: t("pricing.free.cta"),
    },
    {
      tier: t("pricing.pro.tier"),
      desc: t("pricing.pro.desc"),
      amount: PRO_PRICE_EUR,
      per: t("pricing.pro.per"),
      currency: "€",
      pro: true,
      href: "/sign-up",
      badge: t("pricing.pro.badge"),
      features: [
        { label: t("pricing.pro.feat1") },
        { label: t("pricing.pro.feat2") },
        { label: t("pricing.pro.feat3") },
        { label: t("pricing.pro.feat4") },
      ],
      cta: t("pricing.pro.cta"),
    },
    {
      tier: t("pricing.team.tier"),
      desc: t("pricing.team.desc"),
      amount: TEAM_PRICE_EUR,
      per: t("pricing.team.per"),
      currency: "€",
      href: "#",
      features: [
        { label: t("pricing.team.feat1") },
        { label: t("pricing.team.feat2") },
        { label: t("pricing.team.feat3") },
        { label: t("pricing.team.feat4") },
      ],
      cta: t("pricing.team.cta"),
    },
  ];

  return (
    <section className="kin-landing-section" id="precios">
      <div className="kin-landing-wrap">
        <Reveal>
          <OrbitSectionHeader className="kin-landing-head" eyebrow={t("pricing.eyebrow")} title={t("pricing.title")} description={t("pricing.subtitle")} />
        </Reveal>
        <div className="kin-landing-prices">
          {tiers.map((tier, index) => (
            <Reveal key={`${tier.tier || "tier"}-${index}`}>
              <OrbitCard
                className={`kin-landing-price${tier.pro ? " kin-landing-price--pro" : ""}`}
                tone={tier.pro ? "surface-2" : "surface"}
              >
                {tier.badge && (
                  <span className="kin-landing-pill kin-landing-pill--active kin-landing-price__badge">
                    {tier.badge}
                  </span>
                )}
                <div>
                  <div className="kin-landing-price__tier">{tier.tier}</div>
                  <div className="kin-landing-price__desc">{tier.desc}</div>
                </div>
                <div className="kin-landing-price__amount">
                  {tier.currency && <span className="kin-landing-price__cur">{tier.currency}</span>}
                  <span className="kin-landing-price__num">{tier.amount}</span>
                  <span className="kin-landing-price__per">{tier.per}</span>
                </div>
                <ul>
                  {tier.features.map((feat) => (
                    <li key={`${tier.tier}-${feat.label}`} className={feat.muted ? "kin-muted" : ""}>
                      <KinIcon name={feat.muted ? "close" : "check"} size={17} />
                      {feat.label}
                    </li>
                  ))}
                </ul>
                <a className={`kin-btn${tier.pro ? " kin-btn--accent" : ""}`} href={tier.href}>
                  {tier.cta}
                </a>
              </OrbitCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LandingPricing;
