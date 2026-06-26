import { KinIcon, OrbitLogoIcon } from "@/components/icons";

export function LandingFooter({ messages }: { messages: Record<string, string> }) {
  return (
    <footer className="kin-landing-footer">
      <div className="kin-landing-wrap">
        <div className="kin-landing-footer__grid">
          <div className="kin-landing-footer__brand">
            <a className="kin-landing-nav__brand" href="#top">
              <OrbitLogoIcon size={16} decorative className="kin-landing-nav__dot" />
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
              <KinIcon name="instagram" size={16} />
            </a>
            <a href="#" aria-label="X">
              <KinIcon name="x" size={16} />
            </a>
            <a href="#" aria-label="YouTube">
              <KinIcon name="youtube" size={16} />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default LandingFooter;
