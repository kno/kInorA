import React from "react";
import { act, create } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi } from "vitest";
import { resolveMessages } from "../../i18n/locale.js";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `react-native`'s entry point uses Flow's `import typeof` syntax that
// Vite/Rollup cannot parse (no jest-expo/Metro Babel transform in this
// Vitest environment) — same constraint as `@react-navigation/native` in
// `LocaleProvider.test.tsx`. Stub the handful of primitives HomeScreen uses
// with passthrough host-agnostic elements so the REAL component tree
// (including its `useIntl()` call) still renders and can be asserted on.
vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
  Pressable: ({ children, style, ...rest }: any) => (
    <button type="button" {...rest}>
      {typeof children === "function" ? children({ pressed: false }) : children}
    </button>
  ),
  StyleSheet: { create: (styles: unknown) => styles },
  Alert: { alert: vi.fn() },
}));

// `../auth/session-storage` transitively imports `expo-secure-store` →
// `expo-modules-core`, which reads the RN global `__DEV__` at module scope —
// not defined outside a real RN/Expo runtime. HomeScreen only calls
// `deleteSessionToken` (on logout, not exercised by these render assertions).
vi.mock("../../auth/session-storage.js", () => ({
  deleteSessionToken: vi.fn(),
}));

const HomeScreen = (await import("../HomeScreen.js")).default;

// Pure UI screen, no navigation needed for this assertion — a minimal stub
// satisfies the `navigation` prop's shape.
const navigation = { replace: vi.fn() } as any;

function renderWithLocale(locale: "en" | "es") {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <IntlProvider locale={locale} defaultLocale="en" messages={resolveMessages(locale)}>
        <HomeScreen navigation={navigation} />
      </IntlProvider>
    );
  });
  return renderer;
}

describe("HomeScreen (first mobile screen migrated off prop-drilled copy — 9.4.1/9.4.2)", () => {
  it("renders the logout control via useIntl().formatMessage, not a hardcoded literal, in EN", () => {
    const renderer = renderWithLocale("en");
    const text = renderer.root.findAllByProps({ children: "Log out" });
    expect(text.length).toBeGreaterThan(0);
  });

  it("renders the same key's ES translation under the es locale, with no prop-drilled messages", () => {
    const renderer = renderWithLocale("es");
    const text = renderer.root.findAllByProps({ children: "Cerrar sesión" });
    expect(text.length).toBeGreaterThan(0);
  });
});
