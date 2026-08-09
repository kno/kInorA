import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./admin.module.css";

export interface AdminPageShellProps {
  /** Small uppercase kicker above the title ("Backoffice" / "Platform"). */
  eyebrow: string;
  title: string;
  description: string;
  /**
   * Label for the `/admin` crumb. Omitted on the `/admin` landing page itself,
   * which is the root of the section and has nowhere to go back to.
   */
  backLabel?: string;
  children: ReactNode;
}

/**
 * Page chrome shared by the five /admin backoffice routes (kno/kInorA#414),
 * translated from the Open Design `web-admin*.html` screens.
 *
 * It exists to replace `<main className="kin-page"><div className="kin-stack
 * kin-stack--center">`, which every admin route opens with on `main`. That
 * pairing is the login-screen shell: `kin-page` is `min-height: 100vh` with
 * `align-items`/`justify-content: center`, and `kin-stack--center` adds
 * `text-align: center` on top of `kin-stack`'s `max-width: var(--maxw-card)`
 * (24rem). A tenant table, a log viewer and a metrics dashboard are therefore
 * rendered centre-aligned inside a 384px column in a vertically-centring
 * viewport-height flex box. This shell is top-down, full-width and left-aligned
 * instead.
 *
 * kno/kInorA#416 renamed those wrappers from `kin-card` to `kin-stack` so they
 * would not gain a surface and draw a box around the boxes inside them. That
 * was the right call and it is orthogonal to this: the layout defect above is
 * `kin-page` plus the 24rem cap, and both survive the rename untouched.
 *
 * Presentational and synchronous on purpose: the caller is an async server
 * component that has already resolved its own translations, so nothing here
 * needs to be async or client-side.
 */
export function AdminPageShell({
  eyebrow,
  title,
  description,
  backLabel,
  children,
}: AdminPageShellProps) {
  return (
    <main className={styles.shell}>
      <div className={styles.frame}>
        {backLabel ? (
          <nav className={styles.crumbs} aria-label="Breadcrumb">
            <Link href="/admin">{backLabel}</Link>
            <span aria-hidden="true">/</span>
            <span className={styles.crumbsCurrent}>{title}</span>
          </nav>
        ) : null}

        <header className={styles.topbar}>
          <div className={styles.topbarCopy}>
            <div className={styles.eyebrow}>{eyebrow}</div>
            <h1 className={styles.title}>{title}</h1>
            <p>{description}</p>
          </div>
        </header>

        {children}
      </div>
    </main>
  );
}
