"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreateIcon, ExercisesIcon, HomeIcon, PlanIcon, StatsIcon } from "@/components/icons";
import { isActivePath } from "./nav-utils";
import styles from "./MobileNav.module.css";

interface TabItem {
  label: string;
  href: string;
  icon: "home" | "plan" | "stats" | "exercises";
}

const TABS: TabItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "home" },
  { label: "Plan", href: "/plan", icon: "plan" },
  { label: "Statistics", href: "/stats", icon: "stats" },
  { label: "Exercises", href: "/exercises", icon: "exercises" },
];

/**
 * Mobile bottom navigation bar — 4 tabs + centered FAB for Create Plan.
 *
 * Fixed to the bottom of the viewport with safe-area padding for notched
 * devices. Tap targets are at least 44px. Active tab uses --accent color.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <>
      {/* Spacer to prevent content from hiding behind the fixed bar */}
      <span className={styles.spacer} aria-hidden="true" />

      <nav className={styles.bar} aria-label="Mobile navigation">
        {/* Left tabs: Dashboard, Plan */}
        {TABS.slice(0, 2).map((tab) => (
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

        {/* Right tabs: Statistics, Exercises */}
        {TABS.slice(2, 4).map((tab) => (
          <MobileTab
            key={tab.href}
            tab={tab}
            isActive={isActivePath(pathname, tab.href)}
          />
        ))}
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
    case "exercises":
      return <ExercisesIcon className={styles.icon} size={22} />;
  }
}
