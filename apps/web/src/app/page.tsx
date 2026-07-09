import { getTranslations } from "next-intl/server";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingTrust } from "@/components/landing/LandingTrust";
import type { TrustItem } from "@/components/landing/LandingTrust";
import { LandingHowItWorks } from "@/components/landing/LandingHowItWorks";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingPricing } from "@/components/landing/LandingPricing";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { LandingCinemaBand } from "@/components/landing/LandingCinemaBand";

/**
 * Landing page — user-facing copy comes from next-intl (see
 * `@/i18n/request`), whose locale is resolved from the `?lang=` query
 * parameter (via the `x-kinora-lang` header injected by `proxy.ts`) or the
 * `Accept-Language` header. Each section component consumes its own
 * translations directly (no `messages` prop threading) EXCEPT
 * `LandingCinemaBand`/`LandingTrust`, which receive already-resolved
 * strings/arrays as props and are not migrated (see `LandingNav.tsx` and
 * friends for the per-component migration).
 */
export default async function HomePage() {
  const t = await getTranslations();

  const trustItems: TrustItem[] = [
    { icon: "clock", title: t("trust.schedule.title"), desc: t("trust.schedule.desc") },
    { icon: "chart", title: t("trust.level.title"), desc: t("trust.level.desc") },
    { icon: "checkbox", title: t("trust.equipment.title"), desc: t("trust.equipment.desc") },
    { icon: "mic", title: t("trust.hands.title"), desc: t("trust.hands.desc") },
  ];

  return (
    <main>
      <LandingNav />
      <LandingHero />
      <LandingCinemaBand alt={t("marketing.cinemaAlt")} />
      <LandingTrust items={trustItems} />
      <LandingHowItWorks />
      <LandingFeatures />
      <LandingPricing />
      <LandingCTA />
      <LandingFooter />
    </main>
  );
}
