/**
 * PlanStatusScreen — mobile plan-status view (14a Track C2).
 *
 * The RN equivalent of the web plan page's status surface: given a `planId`
 * and/or `planSpecId` route param it fetches the current plan via the C1
 * `plan-status-client` and renders one of four states — loading, generating
 * (with a poll loop that re-reads `fetchPlanStatus` until the plan turns
 * `ready`/`failed`), ready (the `WorkoutProgram.weeklySessions` summary), and
 * failed. A Regenerate action (server-authoritative `regeneratePlan(specId)` →
 * `202` → poll the NEW plan id) is offered in the ready and failed states.
 *
 * Architecture — thin glue over tested modules (the same pattern as
 * `WorkoutTrackerScreen`/`AssistantScreen`): ALL network/result-mapping logic
 * lives in the injected C1 client (`plan-status-client.ts`); this component
 * only owns the small state machine + poll lifecycle + result-code → UI copy.
 *
 * Lifecycle / safety:
 *   - a `mountedRef` guards every post-await `setState` so a late fetch never
 *     writes into a torn-down tree;
 *   - the poll `setInterval` is created only while `generating` and is cleared
 *     on unmount AND whenever the phase leaves `generating` (effect cleanup) —
 *     no leaked interval, no setState-after-unmount;
 *   - a `sessionExpired` result (401 / missing token) clears the stored token
 *     and resets navigation to Login exactly once (guarded by `loggedOutRef`),
 *     mirroring `WorkoutTrackerScreen`'s `handleUnauthenticatedSession`.
 *
 * Result codes surfaced from a regenerate confirm:
 *   - `403` (quota exhausted) → an inline notice (reusing the `adaptation`
 *     i18n copy), the plan is left unchanged;
 *   - `sessionExpired` → route to Login;
 *   - any other error → a graceful generic notice; the plan is left unchanged.
 *   (`409 no_adaptation` is not reachable from regenerate — that is the D1
 *   adherence-adapt banner's concern.)
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { FormattedMessage, useIntl } from "react-intl";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { deleteSessionToken } from "../../auth/session-storage";
import {
  fetchLatestPlanForSpec as defaultFetchLatestPlanForSpec,
  fetchPlanStatus as defaultFetchPlanStatus,
  regeneratePlan as defaultRegeneratePlan,
  type ClientOptions,
  type FetchPlanStatusResult,
  type GenerateResult,
  type PlanStatus,
} from "../../api/plan-status-client";
import { messages as M } from "./messages";
import { styles } from "./PlanStatusScreen.styles";

const DEFAULT_POLL_INTERVAL_MS = 3000;

/** The three C1 client calls the screen depends on — injectable for tests. */
interface PlanStatusClientApi {
  fetchPlanStatus: (
    planId: string,
    options?: ClientOptions,
  ) => Promise<FetchPlanStatusResult>;
  fetchLatestPlanForSpec: (
    specId: string,
    options?: ClientOptions,
  ) => Promise<FetchPlanStatusResult>;
  regeneratePlan: (
    specId: string,
    options?: ClientOptions,
  ) => Promise<GenerateResult>;
}

export type PlanStatusRouteParams = {
  /** A concrete workout plan id to read/poll directly. */
  planId?: string;
  /** A plan spec id — resolves the latest plan for the spec, and the regenerate target. */
  planSpecId?: string;
};

export interface PlanStatusScreenProps {
  navigation: NativeStackNavigationProp<any>;
  route: { params?: PlanStatusRouteParams };
  /** Plan-status client — defaults to the real C1 module; injected in tests. */
  client?: Partial<PlanStatusClientApi>;
  /** Clear the stored session on expiry — defaults to `deleteSessionToken`. */
  clearSession?: () => Promise<void>;
  /** Poll cadence for the generating state (ms). */
  pollIntervalMs?: number;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
}

type Phase = "loading" | "generating" | "ready" | "failed" | "error";

export default function PlanStatusScreen({
  navigation,
  route,
  client,
  clearSession,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  apiBaseUrl,
  getToken,
}: PlanStatusScreenProps) {
  const intl = useIntl();
  const params = route.params ?? {};
  const { planId, planSpecId } = params;

  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<PlanStatus | undefined>();
  const [noticeKey, setNoticeKey] = useState<string | undefined>();
  const [regenerating, setRegenerating] = useState(false);

  // Stable, ref-captured deps so the client/navigation objects can change
  // identity across renders without re-creating callbacks or the store.
  const clientRef = useRef<PlanStatusClientApi>({
    fetchPlanStatus: client?.fetchPlanStatus ?? defaultFetchPlanStatus,
    fetchLatestPlanForSpec:
      client?.fetchLatestPlanForSpec ?? defaultFetchLatestPlanForSpec,
    regeneratePlan: client?.regeneratePlan ?? defaultRegeneratePlan,
  });
  clientRef.current = {
    fetchPlanStatus: client?.fetchPlanStatus ?? defaultFetchPlanStatus,
    fetchLatestPlanForSpec:
      client?.fetchLatestPlanForSpec ?? defaultFetchLatestPlanForSpec,
    regeneratePlan: client?.regeneratePlan ?? defaultRegeneratePlan,
  };
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const clearSessionRef = useRef(clearSession ?? deleteSessionToken);
  clearSessionRef.current = clearSession ?? deleteSessionToken;

  const clientOptions: ClientOptions = { apiBaseUrl, getToken };

  // Mount status — every post-await `setState` is guarded so a late fetch (a
  // navigate-away mid-request or a poll landing after unmount) never writes
  // into a torn-down tree.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A missing/expired token is unrecoverable by retrying the same tokenless
  // request — clear the stored token and route to the auth flow, EXACTLY once
  // (a poll landing right after the initial load must not double-reset nav).
  const loggedOutRef = useRef(false);
  const routeToLogin = useCallback(() => {
    if (loggedOutRef.current) return;
    loggedOutRef.current = true;
    void clearSessionRef.current().finally(() => {
      if (!mountedRef.current) return;
      navigationRef.current.reset({ index: 0, routes: [{ name: "Login" }] });
    });
  }, []);

  // Apply a fetched plan to the state machine (used by the initial load).
  const applyPlanResult = useCallback(
    (result: FetchPlanStatusResult) => {
      if (!mountedRef.current) return;
      if (result.kind === "error") {
        if (result.sessionExpired) {
          routeToLogin();
          return;
        }
        setPhase("error");
        return;
      }
      setPlan(result.plan);
      if (result.plan.status === "ready") setPhase("ready");
      else if (result.plan.status === "failed") setPhase("failed");
      else setPhase("generating");
    },
    [routeToLogin],
  );

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    setPhase("loading");
    setNoticeKey(undefined);

    let result: FetchPlanStatusResult;
    if (planId) {
      result = await clientRef.current.fetchPlanStatus(planId, clientOptions);
    } else if (planSpecId) {
      result = await clientRef.current.fetchLatestPlanForSpec(
        planSpecId,
        clientOptions,
      );
    } else {
      if (mountedRef.current) setPhase("error");
      return;
    }
    applyPlanResult(result);
    // clientOptions is derived from stable props; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, planSpecId, applyPlanResult]);

  useEffect(() => {
    void load();
  }, [load]);

  // One poll pass: re-read the plan's status. A transient (non-session) error
  // is swallowed so the generating view stays put and the next tick retries;
  // a `sessionExpired` routes to Login.
  const poll = useCallback(
    async (id: string) => {
      const result = await clientRef.current.fetchPlanStatus(id, clientOptions);
      if (!mountedRef.current) return;
      if (result.kind === "error") {
        if (result.sessionExpired) routeToLogin();
        return;
      }
      setPlan(result.plan);
      if (result.plan.status === "ready") setPhase("ready");
      else if (result.plan.status === "failed") setPhase("failed");
      // else: still generating — keep polling.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [routeToLogin],
  );

  // The poll interval exists ONLY while generating and is torn down on unmount
  // or whenever the phase/plan-id changes (effect cleanup) — no leaked timers.
  const activePlanId = phase === "generating" ? plan?.id : undefined;
  useEffect(() => {
    if (!activePlanId) return;
    const timer = setInterval(() => {
      void poll(activePlanId);
    }, pollIntervalMs);
    return () => clearInterval(timer);
  }, [activePlanId, pollIntervalMs, poll]);

  // Regenerate target: the plan's own spec, falling back to the route param.
  const specId = plan?.specId ?? planSpecId;

  const handleRegenerate = useCallback(async () => {
    if (!specId || regenerating) return;
    setRegenerating(true);
    setNoticeKey(undefined);
    try {
      const result = await clientRef.current.regeneratePlan(
        specId,
        clientOptions,
      );
      if (!mountedRef.current) return;
      if (result.kind === "error") {
        if (result.sessionExpired) {
          routeToLogin();
          return;
        }
        // 403 → quota-exhausted copy; anything else → a generic notice. The
        // plan is left exactly as it was (no phase change).
        setNoticeKey(result.status === 403 ? M.quotaExhausted.id : M.error.id);
        return;
      }
      // 202 → a fresh generating plan; point the poll loop at the new id.
      setPlan({ id: result.planId, status: result.status, specId });
      setPhase("generating");
    } finally {
      if (mountedRef.current) setRegenerating(false);
    }
    // clientOptions derived from stable props; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specId, regenerating, routeToLogin]);

  /* ── Render ── */

  if (phase === "loading") {
    return (
      <View style={styles.centered} testID="plan-status-loading">
        <ActivityIndicator color={styles.sessionCount.color} />
        <Text style={styles.body}>
          <FormattedMessage {...M.loading} />
        </Text>
      </View>
    );
  }

  if (phase === "error") {
    return (
      <View style={styles.centered} testID="plan-status-error">
        <Text style={styles.errorText} accessibilityRole="alert">
          <FormattedMessage {...M.error} />
        </Text>
        <Pressable
          testID="retry-btn"
          style={[styles.btn, styles.btnSecondary]}
          accessibilityRole="button"
          onPress={load}
        >
          <Text style={styles.btnSecondaryText}>
            <FormattedMessage {...M.retry} />
          </Text>
        </Pressable>
      </View>
    );
  }

  if (phase === "generating") {
    return (
      <View style={styles.centered} testID="plan-status-generating">
        <ActivityIndicator color={styles.sessionCount.color} />
        <Text style={styles.title}>
          <FormattedMessage {...M.generatingTitle} />
        </Text>
        <Text style={styles.body}>
          <FormattedMessage {...M.generatingBody} />
        </Text>
      </View>
    );
  }

  const regenerateButton = specId ? (
    <Pressable
      testID="regenerate-btn"
      style={[styles.btn, styles.btnPrimary, regenerating && styles.btnDisabled]}
      accessibilityRole="button"
      accessibilityState={{ disabled: regenerating }}
      disabled={regenerating}
      onPress={handleRegenerate}
    >
      {regenerating ? (
        <ActivityIndicator color={styles.btnPrimaryText.color} />
      ) : (
        <Text style={styles.btnPrimaryText}>
          <FormattedMessage {...M.regenerate} />
        </Text>
      )}
    </Pressable>
  ) : null;

  const noticeNode = noticeKey ? (
    <Text
      testID="plan-status-notice"
      style={styles.notice}
      accessibilityRole="alert"
    >
      {intl.formatMessage({ id: noticeKey })}
    </Text>
  ) : null;

  if (phase === "failed") {
    return (
      <View style={styles.centered} testID="plan-status-failed">
        <Text style={styles.title}>
          <FormattedMessage {...M.failedTitle} />
        </Text>
        <Text style={styles.body}>
          <FormattedMessage {...M.failedBody} />
        </Text>
        {noticeNode}
        {regenerateButton}
      </View>
    );
  }

  /* ── Ready ── */
  const sessions = plan?.program?.weeklySessions ?? [];
  return (
    <View style={styles.screen} testID="plan-status-ready">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>
          {plan?.name ?? intl.formatMessage(M.readyTitle)}
        </Text>
        <Text style={styles.sessionCount} testID="ready-sessions">
          <FormattedMessage {...M.readySessions} values={{ count: sessions.length }} />
        </Text>

        {sessions.map((session, index) => (
          <View key={index} style={styles.sessionRow} testID="session-row">
            <Text style={styles.sessionTitle}>{session.title}</Text>
          </View>
        ))}

        {noticeNode}
        {regenerateButton}
      </ScrollView>
    </View>
  );
}
