import { OrbitCtaSurface } from "@/components/orbit";

export function LandingCTA({ messages }: { messages: Record<string, string> }) {
  return (
    <section className="kin-landing-section">
      <div className="kin-landing-wrap">
        <OrbitCtaSurface
          className="kin-landing-cta"
          title={messages.cta_title ?? ""}
          description={messages.cta_subtitle ?? ""}
          actions={
            <div className="kin-landing-hero__cta">
              <a className="kin-btn kin-btn--accent" href="/sign-up">
                {messages.cta_primary}
              </a>
              <a className="kin-btn kin-btn--ghost" href="#pricing">
                {messages.cta_secondary}
              </a>
            </div>
          }
        >
          <div className="kin-landing-cta__glow" aria-hidden="true"></div>
        </OrbitCtaSurface>
      </div>
    </section>
  );
}

export default LandingCTA;
