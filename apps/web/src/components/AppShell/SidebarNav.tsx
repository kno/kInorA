"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./SidebarNav.module.css";

/** Navigation item descriptor: label, href, and icon name. */
interface NavItem {
  label: string;
  href: string;
  icon: "home" | "plan" | "stats" | "create" | "exercises";
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "home" },
  { label: "Plan", href: "/plan", icon: "plan" },
  { label: "Statistics", href: "/stats", icon: "stats" },
  { label: "Create Plan", href: "/create-plan", icon: "create" },
  { label: "Exercises", href: "/exercises", icon: "exercises" },
];

/** Check if a pathname matches a nav href (works for exact and sub-paths). */
function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Desktop sidebar navigation — fixed 248px panel.
 *
 * Renders the kInorA wordmark, 5 nav items with SVG icons, and a user
 * area at the bottom with initials placeholder avatar.
 *
 * Active route detection via `usePathname()`. Active items get a subtle
 * `--accent-dim` background with a 3px left accent indicator.
 */
export function SidebarNav() {
  const pathname = usePathname();

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

      {/* User area — placeholder initials until profile endpoint exists */}
      <div className={styles.userArea}>
        <div className={styles.avatar} aria-hidden="true">
          JD
        </div>
        <div className={styles.userInfo}>
          <span className={styles.userName}>User</span>
          <span className={styles.planBadge}>Free</span>
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
  const svgAttrs: React.SVGProps<SVGSVGElement> = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className: styles.icon,
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return (
        <svg {...svgAttrs}>
          <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      );
    case "plan":
      return (
        <svg {...svgAttrs}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
          <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
        </svg>
      );
    case "stats":
      return (
        <svg {...svgAttrs}>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      );
    case "create":
      return (
        <svg {...svgAttrs}>
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="16" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      );
    case "exercises":
      return (
        <svg {...svgAttrs}>
          <path d="M6.5 6.5h11M6.5 17.5h11" />
          <path d="M18.5 3.5a2 2 0 00-2-2h-9a2 2 0 00-2 2v17a2 2 0 002 2h9a2 2 0 002-2v-17z" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}
