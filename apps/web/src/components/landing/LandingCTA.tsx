import { Reveal } from "./Reveal";

export function LandingCTA({ messages }: { messages: Record<string, string> }) {
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
            <h2>{messages.cta_title ?? ""}</h2>
            <p>{messages.cta_subtitle ?? ""}</p>
            <div className="kin-landing-hero__cta">
              <a className="kin-btn kin-btn--accent" href="/sign-up">
                {messages.cta_primary}
              </a>
              <a className="kin-btn kin-btn--ghost" href="#precios" style={{ borderColor: "var(--border)" }}>
                {messages.cta_secondary}
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export default LandingCTA;
