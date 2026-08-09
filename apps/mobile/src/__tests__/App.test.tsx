import React from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

// App.tsx pulls in the full React Navigation stack plus every screen module.
// This test only asserts route REGISTRATION (PR5, 17c), so the navigator
// primitives are replaced with recording stand-ins and every screen module
// with a trivial stub — mirrors HomeScreen.test.tsx's approach of stubbing
// the handful of RN/Expo primitives that cannot run outside a real
// Metro/Expo runtime, rather than mounting the real, deeply-nested screens.
vi.mock("react-native", () => ({
  Linking: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
    getInitialURL: vi.fn(async () => null),
  },
}));

vi.mock("expo-font", () => ({
  useFonts: () => [true],
}));

vi.mock("@expo-google-fonts/space-grotesk", () => ({
  SpaceGrotesk_600SemiBold: "SpaceGrotesk_600SemiBold",
  SpaceGrotesk_700Bold: "SpaceGrotesk_700Bold",
}));

vi.mock("@expo-google-fonts/dm-sans", () => ({
  DMSans_400Regular: "DMSans_400Regular",
  DMSans_500Medium: "DMSans_500Medium",
  DMSans_600SemiBold: "DMSans_600SemiBold",
  DMSans_700Bold: "DMSans_700Bold",
}));

vi.mock("../auth/session-storage", () => ({
  getSessionToken: vi.fn(async () => null),
  setSessionToken: vi.fn(async () => {}),
  REDIRECT_ALLOWLIST: [],
}));

// Records every <Stack.Screen /> registered by App.tsx without mounting the
// real native-stack navigator (which itself needs real `react-native`).
const registeredScreens: { name: string; component: unknown }[] = [];
function Screen(props: { name: string; component: unknown }) {
  registeredScreens.push({ name: props.name, component: props.component });
  return null;
}
function Navigator({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
vi.mock("@react-navigation/native-stack", () => ({
  createNativeStackNavigator: () => ({ Navigator, Screen }),
}));
vi.mock("@react-navigation/native", () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  createNavigationContainerRef: () => ({
    isReady: () => false,
    getCurrentRoute: () => undefined,
    reset: vi.fn(),
  }),
}));

// Every screen is replaced with a trivial stub — the navigator only needs a
// stable component reference to register, it never mounts it here.
function stubScreen(name: string) {
  const Stub = () => null;
  Stub.displayName = name;
  return Stub;
}
vi.mock("../screens/LoginScreen", () => ({ default: stubScreen("Login") }));
vi.mock("../screens/SignUpScreen", () => ({ default: stubScreen("SignUp") }));
vi.mock("../screens/HomeScreen", () => ({ default: stubScreen("Home") }));
vi.mock("../screens/WorkoutTrackerScreen", () => ({
  default: stubScreen("Tracker"),
}));
vi.mock("../screens/HistoryScreen", () => ({ default: stubScreen("History") }));
vi.mock("../screens/create-plan/AssistantScreen", () => ({
  default: stubScreen("CreatePlanAssistant"),
}));
vi.mock("../screens/voice/VoiceScreen", () => ({
  default: stubScreen("CreatePlanVoice"),
}));
vi.mock("../screens/plan/PlanStatusScreen", () => ({
  default: stubScreen("PlanStatus"),
}));
vi.mock("../screens/plan/TrainerPlanScreen", () => ({
  default: stubScreen("TrainerPlan"),
}));
vi.mock("../screens/clients/ClientListScreen", () => ({
  default: stubScreen("ClientList"),
}));
vi.mock("../screens/clients/ClientCreatePlanScreen", () => ({
  default: stubScreen("ClientCreatePlan"),
}));
vi.mock("../screens/profile/ProfileScreen", () => ({
  default: stubScreen("Profile"),
}));
vi.mock("../screens/plans/PlansScreen", () => ({
  default: stubScreen("Plans"),
}));

async function renderApp() {
  const App = (await import("../../App")).default;
  await act(async () => {
    create(<App />);
  });
}

describe("App navigator (17c PR5 — profile screen registration)", () => {
  it("registers the Profile route pointing at ProfileScreen", async () => {
    registeredScreens.length = 0;
    await renderApp();

    const profileRoute = registeredScreens.find((s) => s.name === "Profile");
    expect(profileRoute).toBeTruthy();

    const ProfileScreen = (await import("../screens/profile/ProfileScreen"))
      .default;
    expect(profileRoute?.component).toBe(ProfileScreen);
  });
});

describe("App navigator (17d PR C — plans screen registration)", () => {
  it("registers the Plans route pointing at PlansScreen", async () => {
    registeredScreens.length = 0;
    await renderApp();

    const plansRoute = registeredScreens.find((s) => s.name === "Plans");
    expect(plansRoute).toBeTruthy();

    const PlansScreen = (await import("../screens/plans/PlansScreen")).default;
    expect(plansRoute?.component).toBe(PlansScreen);
  });
});
