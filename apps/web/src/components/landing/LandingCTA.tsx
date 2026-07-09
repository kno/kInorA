import { getTranslations } from "next-intl/server";
import { Reveal } from "./Reveal";

export async function LandingCTA() {
  const t = await getTranslations();

  return (
    <section className="kin-landing-section">
      <div className="kin-landing-wrap">
        <Reveal className="kin-landing-ctaband-photo">
          <div className="kin-landing-cta-bg" aria-hidden="true">
            <picture>
              <source media="(min-width: 801px)" srcSet="/landing/cta-run-1600.webp" width={1600} height={901} />
              <source media="(max-width: 800px)" srcSet="/landing/cta-run-800.webp" width={800} height={451} />
              <img src="/landing/cta-run-1600.webp" alt="" width={1600} height={901} loading="lazy" decoding="async" />
            </picture>
          </div>
          <div className="kin-landing-cta-overlay">
            <h2>{t("cta.title")}</h2>
            <p>{t("cta.subtitle")}</p>
            <div className="kin-landing-hero__cta">
              <a className="kin-btn kin-btn--accent" href="/sign-up">
                {t("cta.primary")}
              </a>
              <a className="kin-btn kin-btn--ghost" href="#precios" style={{ borderColor: "var(--border)" }}>
                {t("cta.secondary")}
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default LandingCTA;
