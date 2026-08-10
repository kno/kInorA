/**
 * LoginScreen / SignUpScreen — the design-parity states from the Open Design
 * screen `mobile-auth.html` (kno/kInorA#445).
 *
 * These two screens had no test at all before this issue. The point of the
 * ones below is NOT the styling: it is that converting the form's failures
 * from a modal `Alert` to the screen's inline banner and field hints kept the
 * decisions identical — the same checks, in the same order, reaching the same
 * endpoints, with the same success path. `Alert.alert` is asserted to be
 * silent for those paths precisely because it used to be the only output.
 *
 * Mocking follows the convention in `HomeScreen.test.tsx` /
 * `HistoryScreen.test.tsx`: `react-native` uses Flow's `import typeof` syntax
 * Vite/Rollup cannot parse under Vitest, so host primitives are stubbed with
 * passthrough elements while the REAL component tree — its `useIntl()` calls
 * included — renders and is asserted on.
 */
import React from "react";
import { act, create } from "react-test-renderer";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveMessages } from "../../i18n/locale.js";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const alert = vi.fn();

vi.mock("react-native", () => ({
  View: "View",
  Text: "Text",
  TextInput: "TextInput",
  TouchableOpacity: "TouchableOpacity",
  ScrollView: "ScrollView",
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: (...args: unknown[]) => alert(...args) },
  StyleSheet: { create: (styles: unknown) => styles },
}));

vi.mock("react-native-svg", () => ({
  default: "Svg",
  Svg: "Svg",
  Circle: "Circle",
  Path: "Path",
  Rect: "Rect",
}));

const setSessionToken = vi.fn(async (_token: string) => {});
vi.mock("../../auth/session-storage.js", () => ({
  setSessionToken: (token: string) => setSessionToken(token),
}));

const LoginScreen = (await import("../LoginScreen.js")).default;
const SignUpScreen = (await import("../SignUpScreen.js")).default;

type Screen = {
  name: string;
  Component: typeof LoginScreen;
  endpoint: string;
  /** Where the footer switch link goes. */
  switchTarget: string;
  submitLabelEs: string;
  pendingLabelEs: string;
};

const SCREENS: Screen[] = [
  {
    name: "LoginScreen",
    Component: LoginScreen,
    endpoint: "/auth/login",
    switchTarget: "SignUp",
    submitLabelEs: "Iniciar sesión",
    pendingLabelEs: "Comprobando…",
  },
  {
    name: "SignUpScreen",
    Component: SignUpScreen,
    endpoint: "/auth/register",
    switchTarget: "Login",
    submitLabelEs: "Crear cuenta",
    pendingLabelEs: "Creando cuenta…",
  },
];

function navigationStub() {
  return { replace: vi.fn(), navigate: vi.fn() } as any;
}

function renderScreen(screen: Screen, navigation: any, locale: "en" | "es" = "es") {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <IntlProvider locale={locale} defaultLocale="en" messages={resolveMessages(locale)}>
        <screen.Component navigation={navigation} />
      </IntlProvider>,
    );
  });
  return renderer;
}

function textOf(renderer: ReturnType<typeof create>): string {
  return JSON.stringify(renderer.toJSON());
}

/** The primary action is the first TouchableOpacity with an `accessibilityRole`. */
function pressPrimary(renderer: ReturnType<typeof create>) {
  const button = renderer.root.findAllByType("TouchableOpacity" as any)[0]!;
  return button.props.onPress();
}

function inputs(renderer: ReturnType<typeof create>) {
  return renderer.root.findAllByType("TextInput" as any);
}

function fillValid(renderer: ReturnType<typeof create>) {
  act(() => {
    inputs(renderer)[0]!.props.onChangeText("lucia.gomez@correo.com");
    inputs(renderer)[1]!.props.onChangeText("supersecret");
  });
}

beforeEach(() => {
  alert.mockReset();
  setSessionToken.mockReset();
  vi.unstubAllGlobals();
});

describe.each(SCREENS)("$name", (screen) => {
  it("renders the brand row, title, both labelled fields and the switch link", () => {
    const rendered = textOf(renderScreen(screen, navigationStub()));

    expect(rendered).toContain("kInorA");
    expect(rendered).toContain("Correo electrónico");
    expect(rendered).toContain("Contraseña");
    expect(rendered).toContain("o continúa con");
    expect(inputs(renderScreen(screen, navigationStub()))).toHaveLength(2);
  });

  it("puts a validation failure under its own field instead of raising an Alert", async () => {
    const renderer = renderScreen(screen, navigationStub());

    act(() => {
      inputs(renderer)[0]!.props.onChangeText("lucia.gomez");
      inputs(renderer)[1]!.props.onChangeText("supersecret");
    });
    await act(async () => {
      await pressPrimary(renderer);
    });

    expect(textOf(renderer)).toContain("Introduce un correo electrónico válido");
    expect(alert).not.toHaveBeenCalled();
  });

  it("reports a short password against the password field", async () => {
    const renderer = renderScreen(screen, navigationStub());

    act(() => {
      inputs(renderer)[0]!.props.onChangeText("lucia.gomez@correo.com");
      inputs(renderer)[1]!.props.onChangeText("1234");
    });
    await act(async () => {
      await pressPrimary(renderer);
    });

    expect(textOf(renderer)).toContain(
      "La contraseña debe tener al menos 8 caracteres",
    );
    expect(alert).not.toHaveBeenCalled();
  });

  it("never reaches the network when the local check fails", async () => {
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const renderer = renderScreen(screen, navigationStub());

    act(() => {
      inputs(renderer)[0]!.props.onChangeText("nope");
      inputs(renderer)[1]!.props.onChangeText("1234");
    });
    await act(async () => {
      await pressPrimary(renderer);
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stores the token and replaces the route on success", async () => {
    const fetchImpl = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ token: "session-token" }),
    }));
    vi.stubGlobal("fetch", fetchImpl);
    const navigation = navigationStub();
    const renderer = renderScreen(screen, navigation);

    fillValid(renderer);
    await act(async () => {
      await pressPrimary(renderer);
    });

    expect(String(fetchImpl.mock.calls[0]![0])).toContain(screen.endpoint);
    expect(setSessionToken).toHaveBeenCalledWith("session-token");
    expect(navigation.replace).toHaveBeenCalledWith("Home");
  });

  it("shows the server's own error in the banner when the submission is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({ error: "invalid_credentials" }) })),
    );
    const navigation = navigationStub();
    const renderer = renderScreen(screen, navigation);

    fillValid(renderer);
    await act(async () => {
      await pressPrimary(renderer);
    });

    expect(textOf(renderer)).toContain("invalid_credentials");
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it("falls back to the screen's own message when the rejection carries no code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const renderer = renderScreen(screen, navigationStub());

    fillValid(renderer);
    await act(async () => {
      await pressPrimary(renderer);
    });

    expect(textOf(renderer)).toContain("El correo o la contraseña no coinciden");
  });

  it("banners a successful response that carries no session token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    const navigation = navigationStub();
    const renderer = renderScreen(screen, navigation);

    fillValid(renderer);
    await act(async () => {
      await pressPrimary(renderer);
    });

    expect(textOf(renderer)).toContain("No se ha recibido ninguna sesión");
    expect(setSessionToken).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("banners an unreachable API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const renderer = renderScreen(screen, navigationStub());

    fillValid(renderer);
    await act(async () => {
      await pressPrimary(renderer);
    });

    expect(textOf(renderer)).toContain("No se ha podido conectar con el servidor");
  });

  it("renders the submitting state while the request is in flight", async () => {
    let release!: (value: unknown) => void;
    const inFlight = new Promise((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await inFlight;
        return { ok: true, json: async () => ({ token: "t" }) };
      }),
    );
    const renderer = renderScreen(screen, navigationStub());

    fillValid(renderer);
    let pending!: Promise<void>;
    act(() => {
      pending = pressPrimary(renderer);
    });

    // The primary button's OWN label, not the whole tree: both idle labels
    // also appear elsewhere on these screens ("Iniciar sesión con Google",
    // the sign-up title, the footer switch link).
    const primary = renderer.root.findAllByType("TouchableOpacity" as any)[0]!;
    const primaryLabel = primary
      .findAllByType("Text" as any)
      .map((node) => node.props.children)
      .flat()
      .join(" ");
    expect(primaryLabel).toContain(screen.pendingLabelEs);
    expect(primaryLabel).not.toContain(screen.submitLabelEs);
    expect(primary.props.disabled).toBe(true);
    expect(renderer.root.findAllByType("ActivityIndicator" as any)).toHaveLength(1);
    expect(inputs(renderer).every((input) => input.props.editable === false)).toBe(true);

    await act(async () => {
      release(undefined);
      await pending;
    });
  });

  it("renders English copy from the EN catalog", () => {
    const rendered = textOf(renderScreen(screen, navigationStub(), "en"));

    expect(rendered).toContain("Email");
    expect(rendered).toContain("Password");
    expect(rendered).toContain("or continue with");
  });

  it("navigates to the other auth screen from the footer link", () => {
    const navigation = navigationStub();
    const renderer = renderScreen(screen, navigation);

    const buttons = renderer.root.findAllByType("TouchableOpacity" as any);
    act(() => {
      buttons[buttons.length - 1]!.props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith(screen.switchTarget);
  });
});
