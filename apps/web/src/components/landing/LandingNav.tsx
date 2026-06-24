export function LandingNav({ messages }: { messages: Record<string, string> }) {
  return (
    <header className="kin-landing-nav" role="banner">
      <div className="kin-landing-nav__inner">
        <a className="kin-landing-nav__brand" href="#top" aria-label="kInorA home">
          <span className="kin-landing-nav__dot" aria-hidden="true"></span>
          {messages.title}
        </a>
        <nav className="kin-landing-nav__links" aria-label="Main">
          <a href="#product">{messages.nav_products}</a>
          <a href="#how-it-works">{messages.nav_how_it_works}</a>
          <a href="#pricing">{messages.nav_pricing}</a>
        </nav>
        <div className="kin-landing-nav__actions">
          <a className="kin-btn kin-btn--ghost" href="/login">
            {messages.nav_login}
          </a>
          <a className="kin-btn kin-btn--accent" href="/sign-up">
            {messages.nav_signup}
          </a>
          <button className="kin-btn kin-btn--ghost kin-landing-nav__toggle" aria-label="Open menu">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" strokeLinecap="round" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

export default LandingNav;
