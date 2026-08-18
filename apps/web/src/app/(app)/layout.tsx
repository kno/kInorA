import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { buildGymStyleBlock } from "@/lib/gym-style";
import { extractGymSlugFromHost } from "@/lib/gym-slug";
import { fetchPublicBranding } from "@/lib/gym-branding-client";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { AppShell } from "@/components/AppShell/AppShell";
import type { SidebarUser } from "@/components/AppShell/SidebarNav";
import { fetchProfile } from "./auth/profile-client";
import { fetchOwnBranding } from "./auth/gym-branding-client";

/**
 * (app) route group layout — renders the responsive AppShell around all
 * authenticated pages.
 *
 * This layout is a server component that resolves the authenticated user's
 * profile and threads it to the AppShell so the sidebar can display real
 * identity data instead of a placeholder fallback.
 *
 * The proxy (`proxy.ts`) gates all `(app)` routes: reaching this layout
 * implies a valid session exists. The shell does NOT re-check auth.
 *
 * 16a-v3-gym-white-label, Slice 5: whole-app post-login theming. The gym
 * theme is resolved from the REQUEST HOST, mirroring the public pages
 * (`app/page.tsx` and `(auth)/login/page.tsx`): the request `Host` header is
 * resolved to a gym slug (`@/lib/gym-slug`) and, when present, the PUBLIC,
 * unauthenticated read-by-slug endpoint (`@/lib/gym-branding-client`) supplies
 * the palette injected as a server-rendered inline `<style>` block via the
 * SAME `buildGymStyleBlock` builder the public pages use (in `@/lib/gym-style`
 * — ONE implementation, no duplication). `globals.css`'s
 * `var(--gym-x, var(--default))` fallback wiring on the base design tokens
 * then reaches every shared layout surface with no per-module rewrite and no
 * JS branching.
 *
 * Host-based (NOT tenant-based) theming is deliberate: the session cookie is
 * parent-domain scoped (`Domain=.kinora.aitsai.com`), so a gym owner's session
 * is valid on the apex too. Keying the theme off the OWN tenant would bleed a
 * gym owner's white-label branding onto the main kInorA apex. Resolving from
 * the host instead means the apex (`kinora.aitsai.com`, `www.`, localhost) has
 * NO slug ⇒ NO `<style>` ⇒ default kInorA theme for everyone (including a
 * logged-in gym owner), while a gym subdomain (`gymX.kinora.aitsai.com`)
 * applies that gym's palette to EVERYONE on the host (owner and their clients).
 *
 * `fetchOwnBranding` is STILL called — but ONLY to derive `isGym` for the gym
 * Branding Studio nav gate (GH #322, a gym-tier entitlement), never to drive
 * the theme. Both fetches (own-tenant for nav, public-by-slug for the theme)
 * run concurrently alongside the profile fetch.
 *
 * `isTrainer` (GH #453 — the "Clients" nav entry) now comes straight off the
 * SAME `fetchProfile` call already made for the sidebar identity, via the
 * `isTrainer` field `GET /auth/profile` returns (mirroring the real server
 * gate: role='trainer' AND resolved tier='trainer'). This removes the
 * separate `GET /trainer/clients` round-trip (`fetchClients`) the layout
 * previously ran only to derive this flag (GH #449). Deny-by-default: a
 * missing profile (no session, or the fetch failed) or a missing/false
 * `isTrainer` field both resolve to `false`. This never runs client-side.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  // Resolve the gym theme from the request host (host-based, not tenant-based)
  // so it never bleeds onto the apex for a parent-domain-scoped session.
  const gymSlug = extractGymSlugFromHost((await headers()).get("host"));

  let user: SidebarUser | undefined;
  let brandingStyle: string | null = null;
  let isAdmin = false;
  let isGym = false;
  let isTrainer = false;
  if (token) {
    // Concurrent fetches: profile + own-tenant branding (both token-gated),
    // plus the PUBLIC host-slug branding (only needs the slug) that drives
    // the theme. `null` when there is no gym slug (apex, www, localhost).
    const [profile, branding, hostBranding] = await Promise.all([
      fetchProfile(token),
      fetchOwnBranding(token),
      gymSlug ? fetchPublicBranding(gymSlug) : Promise.resolve(null),
    ]);
    if (profile) {
      user = {
        initials: profile.initials,
        name: profile.email,
        plan: "Free",
      };
      isAdmin = profile.isAdmin === true;
      // GH #453: deny-by-default — only an explicit `true` from the profile
      // shows the Clients nav entry; missing/false/no-profile all hide it.
      isTrainer = profile.isTrainer === true;
    }
    // Theme comes from the HOST's public branding, never the own tenant.
    if (hostBranding) {
      brandingStyle = buildGymStyleBlock(hostBranding.palette);
    }
    // GH #322: gym-tier nav gate derived from the OWN-tenant branding fetch —
    // no new endpoint. "forbidden" (403) is the only non-gym outcome; "ok" and
    // "not_found" (404, gym tenant with no branding row yet) are both gym.
    // Independent of the host: a gym owner on the apex still sees the nav
    // entry even though no gym theme is applied there.
    isGym = branding.kind === "ok" || branding.kind === "not_found";
  }

  return (
    <>
      {brandingStyle ? <style>{brandingStyle}</style> : null}
      <AppShell
        user={user}
        memoryNavLabel={t("memory.navLabel")}
        billingNavLabel={t("billing.navLabel")}
        isAdmin={isAdmin}
        isGym={isGym}
        isTrainer={isTrainer}
      >
        {children}
      </AppShell>
    </>
  );
}
