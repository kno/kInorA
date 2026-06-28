import { LandingNavClient } from "./LandingNavClient";

export function LandingNav({ messages }: { messages: Record<string, string> }) {
  const links = [
    { href: "#producto", label: messages.nav_products ?? "" },
    { href: "#como", label: messages.nav_how_it_works ?? "" },
    { href: "#precios", label: messages.nav_pricing ?? "" },
  ];

  return (
    <LandingNavClient
      brandLabel={messages.title ?? "kInorA"}
      links={links}
      loginLabel={messages.nav_login ?? ""}
      signupLabel={messages.nav_signup ?? ""}
      menuAriaLabel={messages.nav_menu_label ?? "Abrir menú"}
    />
  );
}

export default LandingNav;
