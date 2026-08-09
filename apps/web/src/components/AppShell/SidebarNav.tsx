"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { BrandingIcon, CreateIcon, ExercisesIcon, HistoryIcon, HomeIcon, PlanIcon, PlansIcon, StatsIcon, UserIcon } from "@/components/icons";
import { isActivePath } from "./nav-utils";
import { logoutAction } from "@/app/(app)/dashboard/actions";
import styles from "./SidebarNav.module.css";

/** Navigation item descriptor: i18n label key (or a resolved label for
 * props-supplied items like Memory/Billing), href, and icon name. */
interface NavItem {
  labelKey?: string;
  label?: string;
  href: string;
  icon: "home" | "plan" | "plans" | "stats" | "history" | "create" | "exercises" | "memory" | "billing" | "admin" | "branding";
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
  { labelKey: "appNav.dashboard", href: "/dashboard", icon: "home" },
  { labelKey: "appNav.plan", href: "/plan", icon: "plan" },
  { labelKey: "appNav.plans", href: "/plans", icon: "plans" },
  { labelKey: "appNav.statistics", href: "/stats", icon: "stats" },
  { labelKey: "appNav.history", href: "/history", icon: "history" },
  { labelKey: "appNav.createPlan", href: "/create-plan", icon: "create" },
  { labelKey: "appNav.exercises", href: "/exercises", icon: "exercises" },
];

/**
 * Desktop sidebar navigation — fixed 248px panel.
 *
 * Renders the kInorA wordmark, nav items, and a user area with a logout
 * button at the bottom. The user identity is supplied via the optional
 * `user` prop (resolved server-side in AppLayout); when absent it falls
 * back to a placeholder.
 */
export function SidebarNav({
  user,
  memoryNavLabel,
  billingNavLabel,
  isAdmin,
  isGym,
}: {
  user?: SidebarUser;
  memoryNavLabel?: string;
  billingNavLabel?: string;
  isAdmin?: boolean;
  isGym?: boolean;
} = {}) {
  const t = useTranslations();
  const pathname = usePathname();
  const identity = user ?? FALLBACK_USER;
  const navItems: NavItem[] = [
    ...NAV_ITEMS,
    ...(memoryNavLabel
      ? [{ label: memoryNavLabel, href: "/memory", icon: "memory" as const }]
      : []),
    ...(billingNavLabel
      ? [{ label: billingNavLabel, href: "/billing", icon: "billing" as const }]
      : []),
    ...(isAdmin === true
      ? [{ labelKey: "appNav.admin", href: "/admin", icon: "admin" as const }]
      : []),
    ...(isGym === true
      ? [{ labelKey: "appNav.branding", href: "/branding", icon: "branding" as const }]
      : []),
  ];

  return (
    <aside className={styles.sidebar} aria-label="Main navigation">
      {/* Brand wordmark — same dot+name as landing nav */}
      <div className={styles.brand}>
        <span className={styles.dot} aria-hidden="true" />
        kInorA
      </div>

      {/* Navigation items */}
      <nav className={styles.nav}>
        {navItems.map((item) => {
          const isActive = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              <NavIcon name={item.icon} />
              <span>{item.label ?? t(item.labelKey!)}</span>
            </Link>
          );
        })}
      </nav>

      {/* User area — real identity when available, or a placeholder.
          The avatar + name surface links to the profile page; the logout
          form stays a sibling (interactive elements must not nest in an <a>). */}
      <div className={styles.userArea}>
        <Link
          href="/profile"
          className={styles.userLink}
          aria-label={identity.name === "Guest" ? "View profile" : `View profile · ${identity.name}`}
        >
          <div className={styles.avatar} aria-hidden="true">
            {identity.initials}
          </div>
          <div className={styles.userInfo}>
            <span className={styles.userName}>{identity.name}</span>
            <span className={styles.planBadge}>{identity.plan}</span>
          </div>
        </Link>
        <form action={logoutAction} className={styles.logoutForm}>
          <button type="submit" className={styles.logoutButton} aria-label={t("appNav.logout")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" aria-hidden="true" focusable="false">
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
    case "plans":
      return <PlansIcon className={styles.icon} size={20} />;
    case "stats":
      return <StatsIcon className={styles.icon} size={20} />;
    case "history":
      return <HistoryIcon className={styles.icon} size={20} />;
    case "create":
      return <CreateIcon className={styles.icon} size={20} />;
    case "exercises":
      return <ExercisesIcon className={styles.icon} size={20} />;
    case "memory":
      return <HistoryIcon className={styles.icon} size={20} />;
    case "billing":
      return <StatsIcon className={styles.icon} size={20} />;
    case "admin":
      return <UserIcon className={styles.icon} size={20} />;
    case "branding":
      return <BrandingIcon className={styles.icon} size={20} />;
  }
}
