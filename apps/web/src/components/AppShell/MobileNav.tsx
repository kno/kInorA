"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CreateIcon, ExercisesIcon, HistoryIcon, HomeIcon, PlanIcon, StatsIcon, UserIcon } from "@/components/icons";
import { isActivePath } from "./nav-utils";
import { logoutAction } from "@/app/(app)/dashboard/actions";
import styles from "./MobileNav.module.css";

interface TabItem {
  labelKey: string;
  label?: string;
  href: string;
  icon: "home" | "plan" | "stats" | "history" | "exercises" | "profile" | "memory" | "billing";
}

// Primary destinations always visible in the bottom bar.
const PRIMARY_TABS: TabItem[] = [
  { labelKey: "appNav.dashboard", href: "/dashboard", icon: "home" },
  { labelKey: "appNav.plan", href: "/plan", icon: "plan" },
  { labelKey: "appNav.history", href: "/history", icon: "history" },
];

// Secondary destinations tucked behind the "More" overflow menu.
const SECONDARY_TABS: TabItem[] = [
  { labelKey: "appNav.statistics", href: "/stats", icon: "stats" },
  { labelKey: "appNav.exercises", href: "/exercises", icon: "exercises" },
  { labelKey: "appNav.profile", href: "/profile", icon: "profile" },
];

/**
 * Mobile bottom navigation bar — a small fixed set of primary tabs +
 * centered Create FAB + a "More" overflow menu holding the rest + logout.
 *
 * Fixed to the bottom of the viewport with safe-area padding for notched
 * devices. Tap targets are at least 44px. Active tab uses --accent color.
 *
 * A small, fixed-width bar can never overflow regardless of how many
 * destinations the app grows to — anything beyond the primary set lives in
 * the "More" menu instead of cramming into the bar (see GH #294).
 */
export function MobileNav({
  memoryNavLabel,
  billingNavLabel,
}: { memoryNavLabel?: string; billingNavLabel?: string } = {}) {
  const t = useTranslations();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const secondaryTabs: TabItem[] = [
    ...SECONDARY_TABS,
    ...(memoryNavLabel
      ? [{ labelKey: "", label: memoryNavLabel, href: "/memory", icon: "memory" as const }]
      : []),
    ...(billingNavLabel
      ? [{ labelKey: "", label: billingNavLabel, href: "/billing", icon: "billing" as const }]
      : []),
  ];

  const isMoreActive = secondaryTabs.some((tab) => isActivePath(pathname, tab.href));

  const closeMenu = () => setMenuOpen(false);

  // Close on outside click/tap.
  useEffect(() => {
    if (!menuOpen) return;

    function handlePointerDown(event: MouseEvent | TouchEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || moreButtonRef.current?.contains(target)) {
        return;
      }
      setMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [menuOpen]);

  // Close on Escape, returning focus to the More button.
  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        moreButtonRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [menuOpen]);

  // Focus the first menu item when the panel opens.
  useEffect(() => {
    if (!menuOpen) return;
    const firstItem = panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();
  }, [menuOpen]);

  return (
    <>
      {/* Spacer to prevent content from hiding behind the fixed bar */}
      <span className={styles.spacer} aria-hidden="true" />

      <nav className={styles.bar} aria-label="Mobile navigation">
        {/* Left tabs: Dashboard, Plan */}
        {PRIMARY_TABS.slice(0, 2).map((tab) => (
          <MobileTab
            key={tab.href}
            tab={tab}
            label={t(tab.labelKey)}
            isActive={isActivePath(pathname, tab.href)}
          />
        ))}

        {/* Centered FAB: Create Plan */}
        <div className={styles.fabArea}>
          <Link
            href="/create-plan"
            className={styles.fab}
            aria-label={t("appNav.createPlan")}
          >
            <CreateIcon className={styles.fabIcon} size={26} />
          </Link>
        </div>

        {/* Right tabs: History, then the More overflow trigger */}
        {PRIMARY_TABS.slice(2).map((tab) => (
          <MobileTab
            key={tab.href}
            tab={tab}
            label={t(tab.labelKey)}
            isActive={isActivePath(pathname, tab.href)}
          />
        ))}

        <button
          type="button"
          ref={moreButtonRef}
          className={`${styles.tab} ${styles.moreButton} ${isMoreActive ? styles.tabActive : ""}`}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreIcon className={styles.icon} />
          <span>{t("appNav.more")}</span>
        </button>
      </nav>

      {menuOpen && <div className={styles.backdrop} onClick={closeMenu} aria-hidden="true" />}

      <div
        id={menuId}
        ref={panelRef}
        role="menu"
        aria-label="More navigation"
        className={styles.menuPanel}
        hidden={!menuOpen}
      >
        {secondaryTabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            role="menuitem"
            className={`${styles.menuItem} ${isActivePath(pathname, tab.href) ? styles.menuItemActive : ""}`}
            aria-current={isActivePath(pathname, tab.href) ? "page" : undefined}
            onClick={closeMenu}
          >
            <TabIcon name={tab.icon} />
            <span>{tab.label ?? t(tab.labelKey)}</span>
          </Link>
        ))}

        <div className={styles.menuDivider} aria-hidden="true" />

        <form action={logoutAction} className={styles.menuLogoutForm} onSubmit={closeMenu}>
          <button type="submit" role="menuitem" className={styles.menuLogoutButton}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden="true" focusable="false">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>{t("appNav.logout")}</span>
          </button>
        </form>
      </div>
    </>
  );
}

export default MobileNav;

// ---------------------------------------------------------------------------
// Sub-component: individual tab item
// ---------------------------------------------------------------------------

function MobileTab({ tab, label, isActive }: { tab: TabItem; label: string; isActive: boolean }) {
  return (
    <Link
      href={tab.href}
      className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
      aria-current={isActive ? "page" : undefined}
    >
      <TabIcon name={tab.icon} />
      <span>{label}</span>
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

function MoreIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      width="22"
      height="22"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}
