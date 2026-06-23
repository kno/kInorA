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