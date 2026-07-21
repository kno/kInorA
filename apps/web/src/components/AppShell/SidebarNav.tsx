"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreateIcon, ExercisesIcon, HistoryIcon, HomeIcon, PlanIcon, StatsIcon } from "@/components/icons";
import { isActivePath } from "./nav-utils";
import { logoutAction } from "@/app/(app)/dashboard/actions";
import styles from "./SidebarNav.module.css";

/** Navigation item descriptor: label, href, and icon name. */
interface NavItem {
  label: string;
  href: string;
  icon: "home" | "plan" | "stats" | "history" | "create" | "exercises";
}

/** Minimal identity shape for the sidebar user area. */
export interface SidebarUser {
  initials: string;
  name: string;
  plan: string;
}

/** Fallback identity shown when no user prop is available. */
const FALLBACK_USER: SidebarUser = {
  initials: "?",
  name: "Guest",
  plan: "Free",
};

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "home" },
  { label: "Plan", href: "/plan", icon: "plan" },
  { label: "Statistics", href: "/stats", icon: "stats" },
  { label: "History", href: "/history", icon: "history" },
  { label: "Create Plan", href: "/create-plan", icon: "create" },
  { label: "Exercises", href: "/exercises", icon: "exercises" },
];

/**
 * Desktop sidebar navigation — fixed 248px panel.
 *
 * Renders the kInorA wordmark, nav items, and a user area with a logout
 * button at the bottom. The user identity is supplied via the optional
 * `user` prop (resolved server-side in AppLayout); when absent it falls
 * back to a placeholder.
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

      {/* User area — real identity when available, or a placeholder. */}
      <div className={styles.userArea}>
        <div className={styles.avatar} aria-hidden="true">
          {identity.initials}
        </div>
        <div className={styles.userInfo}>
          <span className={styles.userName}>{identity.name}</span>
          <span className={styles.planBadge}>{identity.plan}</span>
        </div>
        <form action={logoutAction} className={styles.logoutForm}>
          <button type="submit" className={styles.logoutButton} aria-label="Log out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </form>
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
    case "history":
      return <HistoryIcon className={styles.icon} size={20} />;
    case "create":
      return <CreateIcon className={styles.icon} size={20} />;
    case "exercises":
      return <ExercisesIcon className={styles.icon} size={20} />;
  }
}
