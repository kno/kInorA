export function LandingCTA({ messages }: { messages: Record<string, string> }) {
  return (
    <section className="kin-landing-section">
      <div className="kin-landing-wrap">
        <div className="kin-card kin-card-2 kin-landing-cta">
          <div className="kin-landing-cta__glow" aria-hidden="true"></div>
          <h2>{messages.cta_title}</h2>
          <p>{messages.cta_subtitle}</p>
          <div className="kin-landing-hero__cta">
            <a className="kin-btn kin-btn--accent" href="/sign-up">
              {messages.cta_primary}
            </a>
            <a className="kin-btn kin-btn--ghost" href="#pricing">
              {messages.cta_secondary}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

export default LandingCTA;
