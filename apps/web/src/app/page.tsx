import { resolveLocale, loadMessages } from "@/i18n/locale";
import { headers } from "next/headers";
import type { SupportedLocale, Messages } from "@/i18n/locale";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingTrust } from "@/components/landing/LandingTrust";
import type { TrustItem } from "@/components/landing/LandingTrust";
import { LandingHowItWorks } from "@/components/landing/LandingHowItWorks";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingPricing } from "@/components/landing/LandingPricing";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const langParam =
    typeof params.lang === "string"
      ? params.lang
      : Array.isArray(params.lang)
        ? params.lang[0] ?? null
        : null;

  const requestHeaders = await headers();
  const acceptLanguage = requestHeaders.get("accept-language");

  const locale: SupportedLocale = resolveLocale(acceptLanguage, langParam);
  const messages = loadMessages(locale) as unknown as Record<string, string>;

  const trustItems: TrustItem[] = [
    { icon: "clock", title: messages.trust_title ?? "", desc: messages.trust_desc_schedule ?? "" },
    { icon: "chart", title: messages.trust_title_level ?? "", desc: messages.trust_desc_level ?? "" },
    { icon: "check", title: messages.trust_title_equipment ?? "", desc: messages.trust_desc_equipment ?? "" },
    { icon: "mic", title: messages.trust_title_hands ?? "", desc: messages.trust_desc_hands ?? "" },
  ];

  return (
    <main>
      <LandingNav messages={messages} />
      <LandingHero messages={messages} />
      <LandingTrust items={trustItems} />
      <LandingHowItWorks messages={messages} />
      <LandingFeatures messages={messages} />
      <LandingPricing messages={messages} />
      <LandingCTA messages={messages} />
      <LandingFooter messages={messages} />
    </main>
  );
}
