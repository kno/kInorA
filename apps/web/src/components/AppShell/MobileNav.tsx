"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreateIcon, ExercisesIcon, HistoryIcon, HomeIcon, PlanIcon, StatsIcon, UserIcon } from "@/components/icons";
import { isActivePath } from "./nav-utils";
import { logoutAction } from "@/app/(app)/dashboard/actions";
import styles from "./MobileNav.module.css";

interface TabItem {
  label: string;
  href: string;
  icon: "home" | "plan" | "stats" | "history" | "exercises" | "profile" | "memory" | "billing";
}

const TABS: TabItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "home" },
  { label: "Plan", href: "/plan", icon: "plan" },
  { label: "Statistics", href: "/stats", icon: "stats" },
  { label: "History", href: "/history", icon: "history" },
  { label: "Exercises", href: "/exercises", icon: "exercises" },
  { label: "Profile", href: "/profile", icon: "profile" },
];

/**
 * Mobile bottom navigation bar — tabs + centered FAB for Create Plan + logout.
 *
 * Fixed to the bottom of the viewport with safe-area padding for notched
 * devices. Tap targets are at least 44px. Active tab uses --accent color.
 */
export function MobileNav({
  memoryNavLabel,
  billingNavLabel,
}: { memoryNavLabel?: string; billingNavLabel?: string } = {}) {
  const pathname = usePathname();
  const tabs = [
    ...TABS,
    ...(memoryNavLabel ? [{ label: memoryNavLabel, href: "/memory", icon: "memory" as const }] : []),
    ...(billingNavLabel ? [{ label: billingNavLabel, href: "/billing", icon: "billing" as const }] : []),
  ];

  return (
    <>
      {/* Spacer to prevent content from hiding behind the fixed bar */}
      <span className={styles.spacer} aria-hidden="true" />

      <nav className={styles.bar} aria-label="Mobile navigation">
        {/* Left tabs: Dashboard, Plan, Statistics */}
        {tabs.slice(0, 3).map((tab) => (
          <MobileTab
            key={tab.href}
            tab={tab}
            isActive={isActivePath(pathname, tab.href)}
          />
        ))}

        {/* Centered FAB: Create Plan */}
        <div className={styles.fabArea}>
          <Link
            href="/create-plan"
            className={styles.fab}
            aria-label="Create Plan"
          >
            <CreateIcon className={styles.fabIcon} size={26} />
          </Link>
        </div>

        {/* Right tabs: History, Exercises, Profile, then any trailing
            i18n-gated tabs (Memory, Billing). Use an open-ended slice so a
            newly added trailing tab is never dropped. */}
        {tabs.slice(3).map((tab) => (
          <MobileTab
            key={tab.href}
            tab={tab}
            isActive={isActivePath(pathname, tab.href)}
          />
        ))}

        {/* Logout icon — visible on mobile only */}
        <form action={logoutAction} className={styles.logoutForm}>
          <button type="submit" className={styles.logoutButton} aria-label="Log out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </form>
      </nav>
    </>
  );
}

export default MobileNav;

// ---------------------------------------------------------------------------
// Sub-component: individual tab item
// ---------------------------------------------------------------------------

function MobileTab({ tab, isActive }: { tab: TabItem; isActive: boolean }) {
  return (
    <Link
      href={tab.href}
      className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
      aria-current={isActive ? "page" : undefined}
    >
      <TabIcon name={tab.icon} />
      <span>{tab.label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icon components
// ---------------------------------------------------------------------------

function TabIcon({ name }: { name: TabItem["icon"] }) {
  switch (name) {
    case "home":
      return <HomeIcon className={styles.icon} size={22} />;
    case "plan":
      return <PlanIcon className={styles.icon} size={22} />;
    case "stats":
      return <StatsIcon className={styles.icon} size={22} />;
    case "history":
      return <HistoryIcon className={styles.icon} size={22} />;
    case "exercises":
      return <ExercisesIcon className={styles.icon} size={22} />;
    case "profile":
      return <UserIcon className={styles.icon} size={22} />;
    case "memory":
      return <HistoryIcon className={styles.icon} size={22} />;
    case "billing":
      return <StatsIcon className={styles.icon} size={22} />;
  }
}
