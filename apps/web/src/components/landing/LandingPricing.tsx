/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

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
      amount: "9",
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
      amount: "29",
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
        <div className="kin-landing-head">
          <span className="kin-landing-head__eyebrow">{messages.pricing_eyebrow}</span>
          <h2>{messages.pricing_title}</h2>
          <p>{messages.pricing_subtitle}</p>
        </div>
        <div className="kin-landing-prices">
          {tiers.map((tier, i) => (
            <article
              className={`kin-card kin-landing-price${tier.pro ? " kin-landing-price--pro" : ""}`}
              key={i}
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
                {tier.features.map((feat, j) => (
                  <li key={j} className={feat.muted ? "kin-muted" : ""}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={feat.muted ? "2" : "2.4"} width="17" height="17" aria-hidden="true">
                      {feat.muted ? (
                        <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
                      ) : (
                        <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      )}
                    </svg>
                    {feat.label}
                  </li>
                ))}
              </ul>
              <a className={`kin-btn${tier.pro ? " kin-btn--accent" : ""}`} href={tier.pro ? "/sign-up" : tier.cta === "Talk to sales" ? "#" : "/sign-up"}>
                {tier.cta}
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LandingPricing;
