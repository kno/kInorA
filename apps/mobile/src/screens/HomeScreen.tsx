/**
 * Mobile home screen — authenticated landing + entry to the workout plan.
 *
 * 14a Track C3: this screen now fetches the dashboard summary
 * (`GET /progress/dashboard`, via the C1 `fetchDashboardSummary` client — no
 * new API route) on mount and offers a REAL navigation entry into the
 * `PlanStatus` screen for the user's current plan, resolved from the summary's
 * `adaptation.planSpecId` (attached by the API whenever a ready plan exists,
 * at any adaptation level). This REPLACES the pre-14a manual `workoutPlanId`
 * paste input that only existed while the app had no plan-list/plan surface.
 *
 * States:
 *   - loading      → while the dashboard read is in flight;
 *   - error        → the summary fetch failed (non-session) → graceful notice + Retry;
 *   - sessionExpired (401 / missing token) → clear the stored token and reset
 *     navigation to Login exactly once (mirrors `PlanStatusScreen` /
 *     `WorkoutTrackerScreen`);
 *   - ready + plan → a "View your plan" entry that navigates to `PlanStatus`
 *     with `{ planSpecId }`;
 *   - ready, no plan → a sensible empty state (create a plan to start).
 *
 * Architecture — thin glue over tested modules (same pattern as
 * `PlanStatusScreen`): ALL network/result-mapping logic lives in the injected
 * C1 client (`plan-status-client.ts`); this component only owns the small
 * state machine and the nav wiring.
 *
 * NOTE (D1 seam): `summary.adaptation` is deliberately left UNUSED here beyond
 * resolving `planSpecId`. Track D1 will render the adherence suggestion banner
 * from `summary.adaptation` (level === "low") — see the TODO(D1) marker below.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { useIntl } from "react-intl";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { DashboardSummaryDTO } from "@kinora/contracts";

import { deleteSessionToken } from "../auth/session-storage";
import {
  fetchDashboardSummary as defaultFetchDashboardSummary,
  type ClientOptions,
  type FetchDashboardResult,
} from "../api/plan-status-client";
import AdherenceBanner from "./AdherenceBanner";
import { styles } from "./HomeScreen.styles";

/** The single C1 client call the screen depends on — injectable for tests. */
interface HomeClientApi {
  fetchDashboardSummary: (
    options?: ClientOptions,
  ) => Promise<FetchDashboardResult>;
}

type HomeScreenProps = {
  navigation: NativeStackNavigationProp<any>;
  /** Dashboard client — defaults to the real C1 module; injected in tests. */
  client?: Partial<HomeClientApi>;
  /** Clear the stored session on expiry/logout — defaults to `deleteSessionToken`. */
  clearSession?: () => Promise<void>;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
};

type Phase = "loading" | "error" | "ready";

export default function HomeScreen({
  navigation,
  client,
  clearSession,
  apiBaseUrl,
  getToken,
}: HomeScreenProps) {
  const intl = useIntl();
  const logoutLabel = intl.formatMessage({ id: "dashboard.logout" });
  const historyLabel = intl.formatMessage({ id: "history.title" });
  const createPlanLabel = intl.formatMessage({ id: "chat.teaser.title" });
  const voiceLabel = intl.formatMessage({ id: "voice.screenTitle" });
  // 15b/#294: trainer-only nav entry — gated below on `summary.viewerIsTrainer`
  // (the dashboard read now carries a client-visible role signal).
  const clientsLabel = intl.formatMessage({ id: "clients.navLabel" });
  // 15b/#294: trainer-only nav entry, mirroring `clientsLabel` above.
  const trainerPlanLabel = intl.formatMessage({ id: "trainerPlan.navLabel" });
  // 17c PR5: profile nav entry — reuses web's existing app-nav label, no new
  // catalog key needed (mirrors `ProfileScreen`'s own messages.ts approach).
  const profileLabel = intl.formatMessage({ id: "appNav.profile" });

  const [phase, setPhase] = useState<Phase>("loading");
  const [summary, setSummary] = useState<DashboardSummaryDTO | undefined>();

  // Stable, ref-captured deps so the client/navigation objects can change
  // identity across renders without re-creating callbacks.
  const clientRef = useRef<HomeClientApi>({
    fetchDashboardSummary:
      client?.fetchDashboardSummary ?? defaultFetchDashboardSummary,
  });
  clientRef.current = {
    fetchDashboardSummary:
      client?.fetchDashboardSummary ?? defaultFetchDashboardSummary,
  };
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const clearSessionRef = useRef(clearSession ?? deleteSessionToken);
  clearSessionRef.current = clearSession ?? deleteSessionToken;

  const clientOptions: ClientOptions = { apiBaseUrl, getToken };

  // Mount status — every post-await `setState` is guarded so a late fetch (a
  // navigate-away mid-request) never writes into a torn-down tree.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A missing/expired token is unrecoverable by retrying the same tokenless
  // request — clear the stored token and route to Login EXACTLY once.
  const loggedOutRef = useRef(false);
  const routeToLogin = useCallback(() => {
    if (loggedOutRef.current) return;
    loggedOutRef.current = true;
    void clearSessionRef.current().finally(() => {
      if (!mountedRef.current) return;
      navigationRef.current.reset({ index: 0, routes: [{ name: "Login" }] });
    });
  }, []);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    setPhase("loading");

    const result = await clientRef.current.fetchDashboardSummary(clientOptions);
    if (!mountedRef.current) return;
    if (result.kind === "error") {
      if (result.sessionExpired) {
        routeToLogin();
        return;
      }
      setPhase("error");
      return;
    }
    setSummary(result.summary);
    setPhase("ready");
    // clientOptions is derived from stable props; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeToLogin]);

  useEffect(() => {
    void load();
  }, [load]);

  // The current plan's spec, resolved from the dashboard read. The API attaches
  // `adaptation.planSpecId` whenever a ready plan exists (any adaptation level),
  // so its presence is the "user has a plan" signal for the entry point.
  const planSpecId = summary?.adaptation?.planSpecId;

  // 15b/#294 — Clients/Trainer-plan nav entries are trainer-only. The API
  // attaches `viewerIsTrainer` to the same dashboard read (no extra request).
  const isTrainer = summary?.viewerIsTrainer === true;

  const handleViewPlan = useCallback(() => {
    if (!planSpecId) return;
    navigationRef.current.navigate("PlanStatus", { planSpecId });
  }, [planSpecId]);

  const handleLogout = useCallback(async () => {
    await clearSessionRef.current();
    navigationRef.current.replace("Login");
  }, []);

  /* ── Render ── */

  if (phase === "loading") {
    return (
      <View style={styles.centered} testID="home-loading">
        <ActivityIndicator color={styles.title.color} />
        <Text style={styles.subtitle}>
          {intl.formatMessage({ id: "home.loading" })}
        </Text>
      </View>
    );
  }

  const secondaryMenu = (
    <>
      <Pressable
        style={({ pressed }) => [styles.historyButton, pressed && styles.historyButtonPressed]}
        onPress={() => navigationRef.current.navigate("CreatePlanAssistant")}
        accessibilityRole="button"
        accessibilityLabel={createPlanLabel}
      >
        <Text style={styles.historyText}>{createPlanLabel}</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.historyButton, pressed && styles.historyButtonPressed]}
        onPress={() => navigationRef.current.navigate("CreatePlanVoice")}
        accessibilityRole="button"
        accessibilityLabel={voiceLabel}
      >
        <Text style={styles.historyText}>{voiceLabel}</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.historyButton, pressed && styles.historyButtonPressed]}
        onPress={() => navigationRef.current.navigate("History")}
        accessibilityRole="button"
        accessibilityLabel={historyLabel}
      >
        <Text style={styles.historyText}>{historyLabel}</Text>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.historyButton, pressed && styles.historyButtonPressed]}
        onPress={() => navigationRef.current.navigate("Profile")}
        accessibilityRole="button"
        accessibilityLabel={profileLabel}
      >
        <Text style={styles.historyText}>{profileLabel}</Text>
      </Pressable>

      {isTrainer && (
        <Pressable
          style={({ pressed }) => [styles.historyButton, pressed && styles.historyButtonPressed]}
          onPress={() => navigationRef.current.navigate("ClientList")}
          accessibilityRole="button"
          accessibilityLabel={clientsLabel}
        >
          <Text style={styles.historyText}>{clientsLabel}</Text>
        </Pressable>
      )}

      {isTrainer && (
        <Pressable
          style={({ pressed }) => [styles.historyButton, pressed && styles.historyButtonPressed]}
          onPress={() => navigationRef.current.navigate("TrainerPlan")}
          accessibilityRole="button"
          accessibilityLabel={trainerPlanLabel}
        >
          <Text style={styles.historyText}>{trainerPlanLabel}</Text>
        </Pressable>
      )}

      <Pressable
        style={styles.logoutButton}
        onPress={handleLogout}
        accessibilityRole="button"
        accessibilityLabel={logoutLabel}
      >
        <Text style={styles.logoutText}>{logoutLabel}</Text>
      </Pressable>
    </>
  );

  if (phase === "error") {
    return (
      <View style={styles.container} testID="home-error">
        <Text style={styles.title}>{intl.formatMessage({ id: "home.title" })}</Text>
        <Text style={styles.errorText} accessibilityRole="alert">
          {intl.formatMessage({ id: "home.error" })}
        </Text>
        <Pressable
          testID="home-retry"
          style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
          onPress={load}
          accessibilityRole="button"
          accessibilityLabel={intl.formatMessage({ id: "home.retry" })}
        >
          <Text style={styles.startButtonText}>
            {intl.formatMessage({ id: "home.retry" })}
          </Text>
        </Pressable>
        {secondaryMenu}
      </View>
    );
  }

  /* ── Ready ── */
  // D1: render the adherence suggestion banner from `summary.adaptation`. The
  // banner self-gates — it renders only when `adaptation.level === "low"` with a
  // frequency-reduction `suggestedChange` (and otherwise returns null), reusing
  // the `adaptation.*` i18n namespace and `plan-status-client`'s `adaptPlan`. It
  // reads the summary this screen already fetched (no second dashboard read).

  return (
    // #294: a ScrollView (not a fixed centered View) so the growing secondary
    // menu never overflows/overlaps on short screens. contentContainerStyle
    // keeps the content vertically centered when it fits and scrolls when it
    // doesn't.
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      testID="home-ready"
    >
      <Text style={styles.title}>{intl.formatMessage({ id: "home.title" })}</Text>
      <Text style={styles.subtitle}>{intl.formatMessage({ id: "home.subtitle" })}</Text>

      <AdherenceBanner
        adaptation={summary?.adaptation}
        navigation={navigation}
        clearSession={clearSession}
        apiBaseUrl={apiBaseUrl}
        getToken={getToken}
      />

      {planSpecId ? (
        <Pressable
          testID="home-view-plan"
          style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
          onPress={handleViewPlan}
          accessibilityRole="button"
          accessibilityLabel={intl.formatMessage({ id: "home.viewPlan" })}
        >
          <Text style={styles.startButtonText}>
            {intl.formatMessage({ id: "home.viewPlan" })}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.emptyState} testID="home-no-plan">
          <Text style={styles.emptyTitle}>
            {intl.formatMessage({ id: "home.noPlanTitle" })}
          </Text>
          <Text style={styles.emptyBody}>
            {intl.formatMessage({ id: "home.noPlanBody" })}
          </Text>
        </View>
      )}

      {secondaryMenu}
    </ScrollView>
  );
}
