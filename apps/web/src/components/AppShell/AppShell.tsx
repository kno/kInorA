"use client";

import { useState, useEffect } from "react";
import { SidebarNav } from "./SidebarNav";
import { MobileNav } from "./MobileNav";
import styles from "./AppShell.module.css";

/**
 * Responsive app shell — switches between desktop sidebar and mobile
 * bottom navigation at the 768px breakpoint.
 *
 * On first render (SSR) the mobile nav is shown. Once the client
 * hydrates, the `useEffect` reads `window.matchMedia` and sets the
 * correct layout. The CSS also applies `padding-left: 248px` on the
 * main content area at ≥768px to prevent layout shift on hydration.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
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
      {isDesktop ? <SidebarNav /> : null}
      <main className={styles.main}>{children}</main>
      {!isDesktop ? <MobileNav /> : null}
    </div>
  );
}

export default AppShell;
