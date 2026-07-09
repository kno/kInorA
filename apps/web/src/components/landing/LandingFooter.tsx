import { getTranslations } from "next-intl/server";
import { KinIcon, OrbitLogoIcon } from "@/components/icons";

export async function LandingFooter() {
  const t = await getTranslations();

  return (
    <footer className="kin-landing-footer">
      <div className="kin-landing-wrap">
        <div className="kin-landing-footer__grid">
          <div className="kin-landing-footer__brand">
            <a className="kin-landing-nav__brand" href="#top">
              <OrbitLogoIcon size={16} decorative className="kin-landing-nav__logo" />
              kInorA
            </a>
            <p>{t("footer.tagline")}</p>
          </div>
          <div className="kin-landing-footer__col">
            <h4>{t("footer.product")}</h4>
            <a href="#producto">{t("footer.features")}</a>
            <a href="#como">{t("footer.howItWorks")}</a>
            <a href="#precios">{t("footer.pricing")}</a>
            <a href="#">{t("footer.download")}</a>
          </div>
          <div className="kin-landing-footer__col">
            <h4>{t("footer.company")}</h4>
            <a href="#">{t("footer.about")}</a>
            <a href="#">{t("footer.blog")}</a>
            <a href="#">{t("footer.careers")}</a>
            <a href="#">{t("footer.contact")}</a>
          </div>
          <div className="kin-landing-footer__col">
            <h4>{t("footer.legal")}</h4>
            <a href="#">{t("footer.privacy")}</a>
            <a href="#">{t("footer.terms")}</a>
            <a href="#">{t("footer.cookies")}</a>
          </div>
        </div>
        <div className="kin-landing-footer__bottom">
          <span>{t("footer.copyright")}</span>
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
