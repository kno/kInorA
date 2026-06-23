import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Offline — kInorA",
  robots: { index: false, follow: false },
};

/**
 * Offline fallback page.
 *
 * Shown by the service worker when the network is unavailable and no
 * cached document can be served. Uses the kInorA dark design-system
 * tokens so the experience stays on-brand without a network round-trip.
 */
export default function OfflinePage() {
  return (
    <main className="kin-offline">
      <div className="kin-offline__card">
        <h1 className="kin-offline__title">You&apos;re offline</h1>
        <p className="kin-offline__text">
          kInorA can&apos;t reach the network right now. Your training data
          is safe — reconnect to continue.
        </p>
        <a href="/" className="kin-btn kin-btn--accent">
          Try again
        </a>
      </div>
    </main>
  );
}