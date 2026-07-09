/**
 * Mobile app root component — Expo + React Navigation wiring.
 *
 * This is thin framework glue over pure, unit-tested modules:
 *   - `resolveInitialRoute` / `shouldGuardRoute` (src/auth/session-guard.ts)
 *   - `resolveDeepLinkAction` (src/auth/deep-link.ts)
 *   - `proxyMobileSocialCallback` (src/auth/callback-proxy.ts)
 *   - SecureStore-backed session read/write (src/auth/session-storage.ts)
 *
 * All branching logic lives in those tested pure functions; App.tsx only
 * wires them to the framework (NavigationContainer, Linking). This mirrors
 * the web app's pattern where `middleware.ts` wraps the tested
 * `evaluateAuthGate` and `actions.ts` wraps the tested `submitLogin`.
 *
 * `LocaleProvider` (src/i18n/LocaleProvider.tsx) mounts react-intl's
 * `IntlProvider` above `NavigationContainer`, seeded from the SAME shared
 * `@kinora/i18n` catalogs web consumes — the first mobile consumer of that
 * package (change 100, slice 9).
 *
 * PR4 task 3.1: Expo project entry (`expo/AppEntry.js` loads this default
 * export). React Navigation native stack wires Login/SignUp/Home and
 * integrates the session guard (3.4) + deep-link callback handler (3.3).
 */

import React, { useEffect, useState } from "react";
import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { useFonts } from "expo-font";
import {
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";

import LoginScreen from "./src/screens/LoginScreen";
import SignUpScreen from "./src/screens/SignUpScreen";
import HomeScreen from "./src/screens/HomeScreen";
import WorkoutTrackerScreen, {
  type TrackerRouteParams,
} from "./src/screens/WorkoutTrackerScreen";

import {
  getSessionToken,
  setSessionToken,
  REDIRECT_ALLOWLIST,
} from "./src/auth/session-storage";
import {
  resolveInitialRoute,
  shouldGuardRoute,
} from "./src/auth/session-guard";
import { resolveDeepLinkAction } from "./src/auth/deep-link";
import { proxyMobileSocialCallback } from "./src/auth/callback-proxy";
import { LocaleProvider } from "./src/i18n/LocaleProvider";

type RootStackParamList = {
  Login: undefined;
  SignUp: undefined;
  Home: undefined;
  Tracker: TrackerRouteParams;
};

/** Routes that require an authenticated session; auth routes are never guarded. */
const PROTECTED_ROUTES: (keyof RootStackParamList)[] = ["Home", "Tracker"];

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function App() {
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList>("Login");
  const [hasSession, setHasSession] = useState(false);
  const [isReady, setIsReady] = useState(false);

  // Load the design-system fonts (Space Grotesk display / DM Sans body). The
  // registered keys MUST match the `fonts` tokens in src/theme/tokens.ts.
  const [fontsLoaded] = useFonts({
    "SpaceGrotesk-SemiBold": SpaceGrotesk_600SemiBold,
    "SpaceGrotesk-Bold": SpaceGrotesk_700Bold,
    "DMSans-Regular": DMSans_400Regular,
    "DMSans-Medium": DMSans_500Medium,
    "DMSans-SemiBold": DMSans_600SemiBold,
    "DMSans-Bold": DMSans_700Bold,
  });

  // Startup: read the stored session token and resolve the initial route.
  // Mirrors the web middleware's presence check (no 401/403 — 05b owns that).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getSessionToken();
      if (cancelled) return;
      const present = !!token;
      setHasSession(present);
      setInitialRoute(
        resolveInitialRoute(present) as keyof RootStackParamList
      );
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Deep-link handler: a `kinora://` OAuth callback carries code + state.
  // Validate scheme + allowlist, exchange via the API, store the token,
  // then navigate to the authenticated Home screen.
  async function handleDeepLink(url: string): Promise<void> {
    const action = resolveDeepLinkAction(url, REDIRECT_ALLOWLIST);
    if (action.kind !== "process") return;

    const result = await proxyMobileSocialCallback(action.code, action.state);
    if (result.kind !== "ok") return;

    await setSessionToken(result.token);
    setHasSession(true);
    if (navigationRef.isReady()) {
      navigationRef.reset({ index: 0, routes: [{ name: "Home" }] });
    }
  }

  useEffect(() => {
    const subscription = Linking.addEventListener("url", (event: { url: string }) => {
      void handleDeepLink(event.url);
    });
    void Linking.getInitialURL().then((url) => {
      if (url) void handleDeepLink(url);
    });
    return () => subscription.remove();
  }, []);

  // Navigation guard: redirect unauthenticated users away from protected
  // routes (PR4 task 3.4). Delegates the decision to the tested
  // `shouldGuardRoute` pure function.
  function handleNavigationStateChange(): void {
    if (!navigationRef.isReady()) return;
    const route = navigationRef.getCurrentRoute();
    const routeName = route?.name;
    if (!routeName) return;

    if (shouldGuardRoute(routeName, hasSession, PROTECTED_ROUTES)) {
      navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
    }
  }

  if (!isReady || !fontsLoaded) return null;

  return (
    <LocaleProvider>
      <NavigationContainer
        ref={navigationRef}
        onStateChange={handleNavigationStateChange}
      >
        <Stack.Navigator initialRouteName={initialRoute}>
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="SignUp"
            component={SignUpScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen name="Home" component={HomeScreen} options={{ title: "kInorA" }} />
          <Stack.Screen
            name="Tracker"
            component={WorkoutTrackerScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </LocaleProvider>
  );
}