import { OrbitLogoIcon } from "@/components/icons";

export function LandingNav({ messages }: { messages: Record<string, string> }) {
  return (
    <header className="kin-landing-nav" role="banner">
      <div className="kin-landing-nav__inner">
        <a className="kin-landing-nav__brand" href="#top" aria-label="kInorA home">
          <OrbitLogoIcon size={16} decorative className="kin-landing-nav__logo" />
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
        </div>
      </div>
    </header>
  );
}

export default LandingNav;
