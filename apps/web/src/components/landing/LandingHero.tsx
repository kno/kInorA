export function LandingHero({ messages }: { messages: Record<string, string> }) {
  return (
    <section className="kin-landing-hero" id="product">
      <div className="kin-landing-wrap kin-landing-hero__grid">
        <div className="hero-copy">
          <span className="kin-landing-head__eyebrow">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" aria-hidden="true">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
              <circle cx="12" cy="12" r="2.5" />
            </svg>
            {messages.hero_eyebrow}
          </span>
          <h1 dangerouslySetInnerHTML={{ __html: messages.hero_title ?? "" }} />
          <p className="kin-landing-hero__sub">{messages.hero_subtitle}</p>
          <div className="kin-landing-hero__cta">
            <a className="kin-btn kin-btn--accent" href="/sign-up">
              {messages.hero_cta_primary}
            </a>
            <a className="kin-btn kin-btn--ghost" href="#how-it-works">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              {messages.hero_cta_secondary}
            </a>
          </div>
          <div className="kin-landing-hero__meta">
            <span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {messages.hero_meta_nocard}
            </span>
            <span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {messages.hero_meta_homegym}
            </span>
            <span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
                    </svg>
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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="13" height="13">
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="kin-landing-phone__ex-name">Barbell Squat</span>
                  <span className="kin-landing-phone__ex-set">4 × 8</span>
                </div>
                <div className="kin-landing-phone__ex-row kin-landing-phone__ex-row--done">
                  <span className="kin-landing-phone__ex-check">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="13" height="13">
                      <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
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
