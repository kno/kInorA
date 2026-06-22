import type { UserConfig } from "vitest/config";

export const coverageConfig = {
  provider: "v8",
  reporter: ["text", "lcov"],
  include: ["src/**/*.{ts,tsx}"],
  exclude: [
    "src/**/*.test.{ts,tsx}",
    "src/**/__tests__/**",
    "src/**/*.d.ts",
    "src/app/layout.tsx",
  ],
  thresholds: {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  },
} satisfies NonNullable<NonNullable<UserConfig["test"]>["coverage"]>;
