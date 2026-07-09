import { getTranslations } from "next-intl/server";
import { LandingNavClient } from "./LandingNavClient";

export async function LandingNav() {
  const t = await getTranslations();

  const links = [
    { href: "#producto", label: t("nav.products") },
    { href: "#como", label: t("nav.howItWorks") },
    { href: "#precios", label: t("nav.pricing") },
  ];

  return (
    <LandingNavClient
      brandLabel={t("marketing.title")}
      links={links}
      loginLabel={t("nav.login")}
      signupLabel={t("nav.signup")}
      menuAriaLabel={t("nav.menuLabel")}
      navAriaLabel={t("nav.ariaLabel")}
    />
  );
}

export default LandingNav;
