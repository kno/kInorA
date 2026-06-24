import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Content-tied revision for the precached `/offline` fallback.
 *
 * Hashing the offline page source means the service-worker precache
 * revision only changes when the offline page actually changes — a
 * deterministic value across builds/restarts (unlike `crypto.randomUUID()`,
 * which forced a new precache on every build). Falls back to a static
 * revision if the source cannot be read at config-eval time.
 */
function offlineRevision(): string {
  try {
    const offlinePagePath = fileURLToPath(
      new URL("./src/app/offline/page.tsx", import.meta.url),
    );
    const source = readFileSync(offlinePagePath);
    return createHash("sha256").update(source).digest("hex").slice(0, 12);
  } catch {
    return "offline-static";
  }
}

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Precache the offline fallback so it survives a hard network failure.
  additionalPrecacheEntries: [{ url: "/offline", revision: offlineRevision() }],
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // Next.js 16 defaults to Turbopack. @serwist/next injects a webpack config
  // (used only for the production SW build, since Serwist is disabled in dev),
  // which trips Next's "webpack config + no turbopack config" guard. An empty
  // turbopack config opts dev into Turbopack explicitly and silences the error.
  turbopack: {},
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://api:4000/api/:path*",
      },
    ];
  },
};

export default withSerwist(nextConfig);