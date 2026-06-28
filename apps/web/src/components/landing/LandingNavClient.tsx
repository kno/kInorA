"use client";
import { useEffect, useState } from "react";

/** Returns true when the page has scrolled past the frost threshold. */
export function shouldFrost(scrollY: number): boolean {
  return scrollY > 16;
}

interface LandingNavClientProps {
  brandLabel: string;
  links: { href: string; label: string }[];
  loginLabel: string;
  signupLabel: string;
  menuAriaLabel: string;
}

export function LandingNavClient({
  brandLabel,
  links,
  loginLabel,
  signupLabel,
  menuAriaLabel,
}: LandingNavClientProps) {
  const [frosted, setFrosted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setFrosted(shouldFrost(window.scrollY));
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const menuId = "kin-nav-mobile-menu";

  return (
    <header
      className={`kin-landing-nav${frosted ? " kin-landing-nav--scrolled" : ""}`}
      role="banner"
    >
      <div className="kin-landing-nav__inner">
        <a className="kin-landing-nav__brand" href="#top" aria-label="kInorA home">
          <span className="kin-landing-nav__dot" aria-hidden="true"></span>
          {brandLabel}
        </a>

        <nav
          id={menuId}
          className={`kin-landing-nav__links${menuOpen ? " kin-landing-nav__links--open" : ""}`}
          aria-label="Principal"
        >
          {links.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="kin-landing-nav__actions">
          <a className="kin-btn kin-btn--ghost kin-landing-nav__login" href="/login">
            {loginLabel}
          </a>
          <a className="kin-btn kin-btn--accent" href="/sign-up">
            {signupLabel}
          </a>
          <button
            className="kin-btn kin-btn--ghost kin-landing-nav__toggle"
            aria-label={menuAriaLabel}
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              width={20}
              height={20}
              strokeLinecap="round"
              aria-hidden="true"
            >
              {menuOpen ? (
                <path d="M6 6l12 12M18 6 6 18" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" />
              )}
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

export default LandingNavClient;
