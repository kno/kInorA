import { KinIcon } from "@/components/icons";

export function LandingHero({ messages }: { messages: Record<string, string> }) {
  return (
    <section className="kin-landing-hero" id="product">
      <div className="kin-landing-wrap kin-landing-hero__grid">
        <div className="hero-copy">
          <span className="kin-landing-head__eyebrow">
            <KinIcon name="target" size={14} />
            {messages.hero_eyebrow}
          </span>
          <h1>
            {messages.hero_title}
            <em>{messages.hero_title_accent}</em>
          </h1>
          <p className="kin-landing-hero__sub">{messages.hero_subtitle}</p>
          <div className="kin-landing-hero__cta">
            <a className="kin-btn kin-btn--accent" href="/sign-up">
              {messages.hero_cta_primary}
            </a>
            <a className="kin-btn kin-btn--ghost" href="#how-it-works">
              <KinIcon name="play" size={18} />
              {messages.hero_cta_secondary}
            </a>
          </div>
          <div className="kin-landing-hero__meta">
            <span>
              <KinIcon name="check" size={16} />
              {messages.hero_meta_nocard}
            </span>
            <span>
              <KinIcon name="check" size={16} />
              {messages.hero_meta_homegym}
            </span>
            <span>
              <KinIcon name="check" size={16} />
              {messages.hero_meta_iosandroid}
            </span>
          </div>
        </div>

        <div className="kin-landing-hero__visual">
          <div className="kin-landing-hero__glow" aria-hidden="true"></div>
          <div className="kin-landing-phone" role="img" aria-label="App preview showing today's workout, weekly streak, and progress">
            <div className="kin-landing-phone__screen">
              <div className="kin-landing-phone__top">
                <div className="kin-landing-phone__who">
                  <span className="kin-landing-phone__avatar">
                    <KinIcon name="user" size={18} />
                  </span>
                  <div>
                    <div className="kin-landing-phone__label">Coach kInorA</div>
                    <div className="kin-landing-phone__name">Day 4 · Strength</div>
                  </div>
                </div>
              </div>

              <div className="kin-landing-phone__ring-card">
                <div className="kin-landing-phone__ring">
                  <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
                    <circle cx="38" cy="38" r="32" fill="none" stroke="var(--surface)" strokeWidth="7" />
                    <circle cx="38" cy="38" r="32" fill="none" stroke="var(--accent)" strokeWidth="7" strokeDasharray="201" strokeDashoffset="60" strokeLinecap="round" transform="rotate(-90 38 38)" />
                  </svg>
                  <span className="kin-landing-phone__pct">72%</span>
                </div>
                <div className="kin-landing-phone__ring-meta">
                  <div className="kin-landing-phone__ring-h">Weekly goal</div>
                  <div className="kin-landing-phone__ring-v">3 of 4 sessions</div>
                </div>
              </div>

              <div className="kin-landing-phone__workout">
                <div className="kin-landing-phone__work-head">
                  <span className="kin-landing-phone__work-t">Today's workout</span>
                  <span className="kin-landing-phone__work-dur">42 min</span>
                </div>
                <div className="kin-landing-phone__ex-row kin-landing-phone__ex-row--done">
                  <span className="kin-landing-phone__ex-check">
                    <KinIcon name="check" size={13} />
                  </span>
                  <span className="kin-landing-phone__ex-name">Barbell Squat</span>
                  <span className="kin-landing-phone__ex-set">4 × 8</span>
                </div>
                <div className="kin-landing-phone__ex-row kin-landing-phone__ex-row--done">
                  <span className="kin-landing-phone__ex-check">
                    <KinIcon name="check" size={13} />
                  </span>
                  <span className="kin-landing-phone__ex-name">Bench Press</span>
                  <span className="kin-landing-phone__ex-set">4 × 10</span>
                </div>
                <div className="kin-landing-phone__ex-row">
                  <span className="kin-landing-phone__ex-check"></span>
                  <span className="kin-landing-phone__ex-name">Dumbbell Row</span>
                  <span className="kin-landing-phone__ex-set">3 × 12</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default LandingHero;
