"use client";

import { useState, useEffect } from "react";
import { SidebarNav, type SidebarUser } from "./SidebarNav";
import { MobileNav } from "./MobileNav";
import styles from "./AppShell.module.css";

/**
 * Responsive app shell — switches between desktop sidebar and mobile
 * bottom navigation at the 768px breakpoint.
 *
 * On first render (SSR) the mobile nav is shown. Once the client
 * hydrates, the `useEffect` reads `window.matchMedia` and sets the
 * correct layout.
 *
 * The optional `user` prop carries authenticated identity data so the
 * sidebar can display real user info instead of a placeholder fallback.
 */
export function AppShell({
  children,
  user,
  memoryNavLabel,
  billingNavLabel,
  isAdmin,
  isGym,
}: {
  children: React.ReactNode;
  user?: SidebarUser;
  memoryNavLabel?: string;
  billingNavLabel?: string;
  isAdmin?: boolean;
  isGym?: boolean;
}) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mql.matches);

    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return (
    <div className={styles.shell}>
      {isDesktop ? (
        <SidebarNav
          user={user}
          memoryNavLabel={memoryNavLabel}
          billingNavLabel={billingNavLabel}
          isAdmin={isAdmin}
          isGym={isGym}
        />
      ) : null}
      <main className={styles.main}>{children}</main>
      {!isDesktop ? (
        <MobileNav
          memoryNavLabel={memoryNavLabel}
          billingNavLabel={billingNavLabel}
          isAdmin={isAdmin}
          isGym={isGym}
        />
      ) : null}
    </div>
  );
}

export default AppShell;
