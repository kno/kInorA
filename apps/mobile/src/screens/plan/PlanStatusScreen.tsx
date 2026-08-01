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
 * Poll-loop robustness (post-C2-review fixes):
 *   - a poll-time error (e.g. the backend goes down mid-generation) is
 *     tolerated for one consecutive failure (a transient blip self-heals on
 *     the next tick), but `POLL_ERROR_THRESHOLD` consecutive failures surface
 *     the SAME error state + Retry the initial load uses — the screen never
 *     silently spins forever on a dead backend;
 *   - a genuinely stalled plan (never leaves `generating`) is capped at
 *     `maxPollAttempts` polls (default `DEFAULT_MAX_POLL_ATTEMPTS`, ~2 min at
 *     the default cadence); once the cap is hit the screen shows a terminal
 *     "taking longer than expected" state with a manual Refresh that resets
 *     the counters and restarts polling immediately.
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
/** Consecutive poll-time errors tolerated before surfacing the error state. */
const POLL_ERROR_THRESHOLD = 2;
/** ~2 min of polling at the default 3s cadence before the stalled terminal state. */
const DEFAULT_MAX_POLL_ATTEMPTS = 40;

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
  /** Max consecutive polls while `generating` before the terminal "stalled" state. */
  maxPollAttempts?: number;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
}

type Phase = "loading" | "generating" | "ready" | "failed" | "error" | "stalled";

export default function PlanStatusScreen({
  navigation,
  route,
  client,
  clearSession,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS,
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

  // Poll-loop counters (post-C2-review fixes). Reset whenever a FRESH
  // generating loop starts (initial load, regenerate confirm, stalled Refresh)
  // so a prior loop's failures/attempts never bleed into the next one.
  const pollErrorCountRef = useRef(0);
  const pollAttemptsRef = useRef(0);
  const resetPollCounters = () => {
    pollErrorCountRef.current = 0;
    pollAttemptsRef.current = 0;
  };

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
      else {
        resetPollCounters();
        setPhase("generating");
      }
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

  // One poll pass: re-read the plan's status.
  //   - a `sessionExpired` result routes to Login;
  //   - a non-session error is tolerated for one consecutive failure (a
  //     transient blip self-heals on the next tick), but
  //     `POLL_ERROR_THRESHOLD` consecutive failures surface the SAME error
  //     state + Retry the initial load uses — never a silent forever-spin;
  //   - a successful "still generating" response resets the error counter and
  //     increments the attempt counter; hitting `maxPollAttempts` surfaces the
  //     terminal "stalled" state instead of polling indefinitely.
  const poll = useCallback(
    async (id: string) => {
      const result = await clientRef.current.fetchPlanStatus(id, clientOptions);
      if (!mountedRef.current) return;
      if (result.kind === "error") {
        if (result.sessionExpired) {
          routeToLogin();
          return;
        }
        pollErrorCountRef.current += 1;
        if (pollErrorCountRef.current >= POLL_ERROR_THRESHOLD) {
          setPhase("error");
        }
        return;
      }
      pollErrorCountRef.current = 0;
      setPlan(result.plan);
      if (result.plan.status === "ready") {
        setPhase("ready");
        return;
      }
      if (result.plan.status === "failed") {
        setPhase("failed");
        return;
      }
      // Still generating.
      pollAttemptsRef.current += 1;
      if (pollAttemptsRef.current >= maxPollAttempts) {
        setPhase("stalled");
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [routeToLogin, maxPollAttempts],
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
      resetPollCounters();
      setPlan({ id: result.planId, status: result.status, specId });
      setPhase("generating");
    } finally {
      if (mountedRef.current) setRegenerating(false);
    }
    // clientOptions derived from stable props; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specId, regenerating, routeToLogin]);

  // Refresh from the "stalled" terminal state: reset the poll counters,
  // re-enter `generating` (which restarts the interval), and poll immediately
  // instead of waiting a full cadence for the first refreshed read.
  const handleRefreshStalled = useCallback(async () => {
    if (!plan?.id) {
      await load();
      return;
    }
    resetPollCounters();
    setPhase("generating");
    await poll(plan.id);
  }, [plan?.id, poll, load]);

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

  if (phase === "stalled") {
    return (
      <View style={styles.centered} testID="plan-status-stalled">
        <Text style={styles.title}>
          <FormattedMessage {...M.stalledTitle} />
        </Text>
        <Text style={styles.body}>
          <FormattedMessage {...M.stalledBody} />
        </Text>
        <Pressable
          testID="refresh-btn"
          style={[styles.btn, styles.btnSecondary]}
          accessibilityRole="button"
          onPress={handleRefreshStalled}
        >
          <Text style={styles.btnSecondaryText}>
            <FormattedMessage {...M.refresh} />
          </Text>
        </Pressable>
      </View>
    );
  }

  /* ── Ready ── */
  const sessions = plan?.program?.weeklySessions ?? [];
  // 15b-v2 S4 accent-only theming seam: `branding.accentColor` overrides the
  // static `colors.accent` token on the accent-themed surfaces (session
  // count) when present; absent branding leaves the base token untouched.
  const branding = plan?.branding;
  const accentOverride = branding?.accentColor
    ? { color: branding.accentColor }
    : null;
  return (
    <View style={styles.screen} testID="plan-status-ready">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>
          {branding?.title ?? plan?.name ?? intl.formatMessage(M.readyTitle)}
        </Text>
        {branding?.trainerName && (
          <Text style={styles.body} testID="branding-byline">
            <FormattedMessage {...M.brandedBy} values={{ trainerName: branding.trainerName }} />
          </Text>
        )}
        <Text
          style={[styles.sessionCount, accentOverride]}
          testID="ready-sessions"
        >
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
