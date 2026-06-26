"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreateIcon, ExercisesIcon, HomeIcon, PlanIcon, StatsIcon } from "@/components/icons";
import { isActivePath } from "./nav-utils";
import styles from "./SidebarNav.module.css";

/** Navigation item descriptor: label, href, and icon name. */
interface NavItem {
  label: string;
  href: string;
  icon: "home" | "plan" | "stats" | "create" | "exercises";
}

/** Minimal identity shape for the sidebar user area. */
export interface SidebarUser {
  initials: string;
  name: string;
  plan: string;
}

/** Fallback identity shown until a real profile endpoint exists. */
const FALLBACK_USER: SidebarUser = {
  initials: "JD",
  name: "User",
  plan: "Free",
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "home" },
  { label: "Plan", href: "/plan", icon: "plan" },
  { label: "Statistics", href: "/stats", icon: "stats" },
  { label: "Create Plan", href: "/create-plan", icon: "create" },
  { label: "Exercises", href: "/exercises", icon: "exercises" },
];

/**
 * Desktop sidebar navigation — fixed 248px panel.
 *
 * Renders the kInorA wordmark, 5 nav items with SVG icons, and a user
 * area at the bottom. The user identity is supplied via the optional
 * `user` prop; when absent it falls back to a placeholder until a real
 * profile endpoint exists.
 *
 * Active route detection via `usePathname()`. Active items get a subtle
 * `--accent-dim` background with a 3px left accent indicator.
 */
export function SidebarNav({ user }: { user?: SidebarUser } = {}) {
  const pathname = usePathname();
  const identity = user ?? FALLBACK_USER;

  return (
    <aside className={styles.sidebar} aria-label="Main navigation">
      {/* Brand wordmark — same dot+name as landing nav */}
      <div className={styles.brand}>
        <span className={styles.dot} aria-hidden="true" />
        kInorA
      </div>

      {/* Navigation items */}
      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const isActive = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User area — uses the `user` prop, or a placeholder fallback. */}
      <div className={styles.userArea}>
        <div className={styles.avatar} aria-hidden="true">
          {identity.initials}
        </div>
        <div className={styles.userInfo}>
          <span className={styles.userName}>{identity.name}</span>
          <span className={styles.planBadge}>{identity.plan}</span>
        </div>
      </div>
    </aside>
  );
}

export default SidebarNav;

// ---------------------------------------------------------------------------
// Inline SVG icon components
// ---------------------------------------------------------------------------

function NavIcon({ name }: { name: NavItem["icon"] }) {
  switch (name) {
    case "home":
      return <HomeIcon className={styles.icon} size={20} />;
    case "plan":
      return <PlanIcon className={styles.icon} size={20} />;
    case "stats":
      return <StatsIcon className={styles.icon} size={20} />;
    case "create":
      return <CreateIcon className={styles.icon} size={20} />;
    case "exercises":
      return <ExercisesIcon className={styles.icon} size={20} />;
  }
}
