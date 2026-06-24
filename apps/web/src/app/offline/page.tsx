import React from "react";

/**
 * Offline fallback page — shown by the service worker when the user
 * navigates without a network connection.
 *
 * Uses `kin-*` design token classes from globals.css instead of
 * inline styles.
 */
export default function OfflinePage() {
  return (
    <div className="kin-offline">
      <div className="kin-offline__card">
        <h1 className="kin-offline__title">You&apos;re Offline</h1>
        <p className="kin-offline__text">
          It looks like you&apos;re currently disconnected from the internet.
          Please check your connection and try again.
        </p>
        <div className="kin-card">
          <p className="kin-offline__text">
            Your data will be synced once you&apos;re back online.
          </p>
        </div>
      </div>
    </div>
  );
}
