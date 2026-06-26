import { KinIcon } from "@/components/icons";
import { OrbitCard, OrbitSectionHeader } from "@/components/orbit";

/** Monthly price in EUR for the Pro tier. */
const PRO_PRICE_EUR = "9";
/** Monthly price in EUR for the Teams tier. */
const TEAM_PRICE_EUR = "29";

interface PricingTier {
  tier: string;
  desc: string;
  amount: string;
  per: string;
  features: { label: string; muted?: boolean }[];
  cta: string;
  pro?: boolean;
  badge?: string;
  currency?: string;
}

export function LandingPricing({ messages }: { messages: Record<string, string> }) {
  const tiers: PricingTier[] = [
    {
      tier: messages.pricing_free_tier ?? "",
      desc: messages.pricing_free_desc ?? "",
      amount: messages.pricing_free_amount ?? "",
      per: messages.pricing_free_per ?? "",
      currency: "€",
      features: [
        { label: messages.pricing_free_feat1 ?? "" },
        { label: messages.pricing_free_feat2 ?? "" },
        { label: messages.pricing_free_feat3 ?? "" },
        { label: messages.pricing_free_feat4 ?? "", muted: true },
      ],
      cta: messages.pricing_free_cta ?? "",
    },
    {
      tier: messages.pricing_pro_tier ?? "",
      desc: messages.pricing_pro_desc ?? "",
      amount: PRO_PRICE_EUR,
      per: messages.pricing_pro_per ?? "",
      currency: "€",
      pro: true,
      badge: messages.pricing_pro_badge ?? "",
      features: [
        { label: messages.pricing_pro_feat1 ?? "" },
        { label: messages.pricing_pro_feat2 ?? "" },
        { label: messages.pricing_pro_feat3 ?? "" },
        { label: messages.pricing_pro_feat4 ?? "" },
      ],
      cta: messages.pricing_pro_cta ?? "",
    },
    {
      tier: messages.pricing_team_tier ?? "",
      desc: messages.pricing_team_desc ?? "",
      amount: TEAM_PRICE_EUR,
      per: messages.pricing_team_per ?? "",
      currency: "€",
      features: [
        { label: messages.pricing_team_feat1 ?? "" },
        { label: messages.pricing_team_feat2 ?? "" },
        { label: messages.pricing_team_feat3 ?? "" },
        { label: messages.pricing_team_feat4 ?? "" },
      ],
      cta: messages.pricing_team_cta ?? "",
    },
  ];

  return (
    <section className="kin-landing-section" id="pricing">
      <div className="kin-landing-wrap">
        <OrbitSectionHeader className="kin-landing-head" eyebrow={messages.pricing_eyebrow ?? ""} title={messages.pricing_title ?? ""} description={messages.pricing_subtitle ?? ""} />
        <div className="kin-landing-prices">
          {tiers.map((tier, index) => (
            <OrbitCard
              className={`kin-landing-price${tier.pro ? " kin-landing-price--pro" : ""}`}
              key={`${tier.tier || "tier"}-${index}`}
              tone={tier.pro ? "surface-2" : "surface"}
            >
              {tier.badge && (
                <span className="pill pill-active kin-landing-price__badge">{tier.badge}</span>
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
                <a className={`kin-btn${tier.pro ? " kin-btn--accent" : ""}`} href={tier.pro ? "/sign-up" : tier.cta === "Talk to sales" ? "#" : "/sign-up"}>
                  {tier.cta}
                </a>
            </OrbitCard>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LandingPricing;
