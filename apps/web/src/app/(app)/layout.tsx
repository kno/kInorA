import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { buildGymStyleBlock } from "@/lib/gym-style";
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
 * 16a-v3-gym-white-label, Slice 5: whole-app post-login theming. When a
 * session token exists, the caller's OWN-tenant branding is fetched from the
 * AUTHENTICATED S3 `GET /branding` endpoint (`gym-branding-client.ts` —
 * fail-safe-to-null, mirrors `profile-client.ts`) and, if found, its palette
 * is injected as a server-rendered inline `<style>` block via the SAME
 * `buildGymStyleBlock` builder Slice 4's login page uses (relocated to
 * `@/lib/gym-style` in this slice so both consume ONE implementation — no
 * duplication). `globals.css`'s `var(--gym-x, var(--default))` fallback
 * wiring on the base design tokens (Slice 5) then reaches every shared
 * layout surface with no per-module rewrite and no JS branching. A member
 * whose tenant has no branding row (404), a non-gym tenant (403), or any
 * fetch failure all resolve to `null` — no `<style>` renders, and the app is
 * byte-identical to before this slice.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getTranslations();
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  let user: SidebarUser | undefined;
  let brandingStyle: string | null = null;
  if (token) {
    const [profile, branding] = await Promise.all([
      fetchProfile(token),
      fetchOwnBranding(token),
    ]);
    if (profile) {
      user = {
        initials: profile.initials,
        name: profile.email,
        plan: "Free",
      };
    }
    if (branding) {
      brandingStyle = buildGymStyleBlock(branding.palette);
    }
  }

  return (
    <>
      {brandingStyle ? <style>{brandingStyle}</style> : null}
      <AppShell
        user={user}
        memoryNavLabel={t("memory.navLabel")}
        billingNavLabel={t("billing.navLabel")}
      >
        {children}
      </AppShell>
    </>
  );
}
