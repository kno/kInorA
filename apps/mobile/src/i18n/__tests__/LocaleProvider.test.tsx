import React from "react";
import { act, create } from "react-test-renderer";
import { IntlProvider, useIntl } from "react-intl";
import { describe, expect, it, vi } from "vitest";
import { LocaleProvider, useLocale } from "../LocaleProvider.js";
import { resolveMessages } from "../locale.js";

// react-test-renderer's `act()` needs this flag set explicitly under React
// 19 in a non-DOM test environment (no jsdom/RN Jest preset here) — without
// it, act() still works but prints a spurious "not configured" warning.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// `@react-navigation/native` re-exports `react-native`'s entry point, which
// uses Flow's `import typeof` syntax that Vite/Rollup cannot parse (no Flow
// support in this test environment — Metro's own Babel transform handles it
// fine at build/runtime, this is purely a Vitest tooling limitation, same
// class of constraint as the RSC/"react-server" condition documented in
// apps/web/src/i18n/__tests__/request.test.ts). Stub it with a passthrough
// component so this test can still assert the STRUCTURAL nesting order
// (IntlProvider wraps NavigationContainer) without ever loading the real
// react-native module graph.
vi.mock("@react-navigation/native", () => ({
  NavigationContainer: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

const { NavigationContainer } = await import("@react-navigation/native");

describe("LocaleProvider", () => {
  it("mounts IntlProvider above NavigationContainer with the shared catalog, locale, and defaultLocale='en' (9.1.2)", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <LocaleProvider>
          <NavigationContainer>{null}</NavigationContainer>
        </LocaleProvider>
      );
    });

    const intlProviderInstance = renderer!.root.findByType(IntlProvider);
    expect(intlProviderInstance.props.locale).toBe("en");
    expect(intlProviderInstance.props.defaultLocale).toBe("en");
    expect(intlProviderInstance.props.messages).toEqual(resolveMessages("en"));

    // NavigationContainer must be a DESCENDANT of IntlProvider, not a sibling
    // or ancestor — the shared i18n boundary has to wrap the whole app.
    const navigationContainerInstance = intlProviderInstance.findByType(NavigationContainer);
    expect(navigationContainerInstance).toBeDefined();
  });

  function LocaleReadout() {
    const intl = useIntl();
    return <>{intl.formatMessage({ id: "dashboard.logout" })}</>;
  }

  function LocaleSwitcher() {
    const { setLocale } = useLocale();
    // Test-only trigger: exposed on globalThis so `act()` can call it
    // without needing RN's Pressable/native event pipeline.
    (globalThis as any).__switchLocale = setLocale;
    return null;
  }

  it("switches the active locale at runtime and re-renders consumers without a remount (9.2.1)", () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <LocaleProvider initialLocale="es">
          <LocaleSwitcher />
          <LocaleReadout />
        </LocaleProvider>
      );
    });

    expect(renderer!.toJSON()).toBe("Cerrar sesión");

    act(() => {
      (globalThis as any).__switchLocale("en");
    });

    expect(renderer!.toJSON()).toBe("Log out");
  });
});
