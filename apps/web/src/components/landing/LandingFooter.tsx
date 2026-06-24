export function LandingFooter({ messages }: { messages: Record<string, string> }) {
  return (
    <footer className="kin-landing-footer">
      <div className="kin-landing-wrap">
        <div className="kin-landing-footer__grid">
          <div className="kin-landing-footer__brand">
            <a className="kin-landing-nav__brand" href="#top">
              <span className="kin-landing-nav__dot" aria-hidden="true"></span>
              kInorA
            </a>
            <p>{messages.footer_tagline}</p>
          </div>
          <div className="kin-landing-footer__col">
            <h4>{messages.footer_product}</h4>
            <a href="#product">{messages.footer_features}</a>
            <a href="#how-it-works">{messages.footer_how_it_works}</a>
            <a href="#pricing">{messages.footer_pricing}</a>
            <a href="#">{messages.footer_download}</a>
          </div>
          <div className="kin-landing-footer__col">
            <h4>{messages.footer_company}</h4>
            <a href="#">{messages.footer_about}</a>
            <a href="#">{messages.footer_blog}</a>
            <a href="#">{messages.footer_careers}</a>
            <a href="#">{messages.footer_contact}</a>
          </div>
          <div className="kin-landing-footer__col">
            <h4>{messages.footer_legal}</h4>
            <a href="#">{messages.footer_privacy}</a>
            <a href="#">{messages.footer_terms}</a>
            <a href="#">{messages.footer_cookies}</a>
          </div>
        </div>
        <div className="kin-landing-footer__bottom">
          <span>{messages.footer_copyright}</span>
          <div className="kin-landing-footer__social">
            <a href="#" aria-label="Instagram">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
              </svg>
            </a>
            <a href="#" aria-label="X">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16">
                <path d="M4 4l16 16M20 4 4 20" strokeLinecap="round" />
              </svg>
            </a>
            <a href="#" aria-label="YouTube">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" width="16" height="16">
                <rect x="3" y="5" width="18" height="14" rx="4" />
                <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default LandingFooter;
