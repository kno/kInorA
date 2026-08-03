import { headers } from "next/headers";
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
import { extractGymSlugFromHost } from "@/lib/gym-slug";
import { fetchPublicBranding } from "@/lib/gym-branding-client";
import { buildGymStyleBlock } from "@/lib/gym-style";

/**
 * Landing page — user-facing copy comes from next-intl (see
 * `@/i18n/request`), whose locale is resolved from the `?lang=` query
 * parameter (via the `x-kinora-lang` header injected by `proxy.ts`) or the
 * `Accept-Language` header. Each section component consumes its own
 * translations directly (no `messages` prop threading) EXCEPT
 * `LandingCinemaBand`/`LandingTrust`, which receive already-resolved
 * strings/arrays as props and are not migrated (see `LandingNav.tsx` and
 * friends for the per-component migration).
 *
 * 16a-v3-gym-white-label — extends the login page's Slice 4 host-resolved
 * theming to the root page so a gym visitor sees the brand on the very
 * first screen. Mirrors `(auth)/login/page.tsx` exactly: the request `Host`
 * header is resolved to a `subdomainSlug` server-side (`@/lib/gym-slug`,
 * Node runtime — this Server Component never sends the host to the
 * client), then the PUBLIC read-by-slug endpoint is fetched
 * (`@/lib/gym-branding-client`). When branding is found, its palette is
 * injected as a server-rendered inline `<style>` block setting the
 * `--gym-*` custom properties on `:root` (see `@/lib/gym-style` and
 * `globals.css`'s `var(--gym-x, var(--default))` fallbacks — no JS
 * branching). No slug, an unknown slug (404), or a failed fetch all fall
 * back to the unmodified default page — a normal (non-gym) visit renders
 * byte-identical to before this change.
 */
export default async function HomePage() {
  const t = await getTranslations();

  const requestHeaders = await headers();
  const gymSlug = extractGymSlugFromHost(requestHeaders.get("host"));
  const branding = gymSlug ? await fetchPublicBranding(gymSlug) : null;

  const trustItems: TrustItem[] = [
    { icon: "clock", title: t("trust.schedule.title"), desc: t("trust.schedule.desc") },
    { icon: "chart", title: t("trust.level.title"), desc: t("trust.level.desc") },
    { icon: "checkbox", title: t("trust.equipment.title"), desc: t("trust.equipment.desc") },
    { icon: "mic", title: t("trust.hands.title"), desc: t("trust.hands.desc") },
  ];

  return (
    <main>
      {branding ? <style>{buildGymStyleBlock(branding.palette)}</style> : null}
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
