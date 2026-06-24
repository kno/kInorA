import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Precache the offline fallback so it survives a hard network failure.
  additionalPrecacheEntries: [{ url: "/offline", revision: crypto.randomUUID() }],
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