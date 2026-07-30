/**
 * AdherenceBanner — mobile adherence suggestion banner (14a Track D1).
 *
 * The RN counterpart of the web `DashboardCoachCard`'s `AdaptationBanner`. It
 * consumes the dashboard summary's `adaptation` recommendation (already fetched
 * by `HomeScreen` via the C1 `fetchDashboardSummary` — this banner never fires
 * a second read) and renders an option-framed "fancy a lighter week?" surface
 * ONLY when `adaptation.level === "low"` carries a `reduce_frequency`
 * `suggestedChange` and a `planSpecId`. `ok` / `insufficient_data`, or a `low`
 * at the daysPerWeek floor (no actionable change) render NOTHING.
 *
 * Accept → the server-authoritative C1 `adaptPlan(planSpecId)` (posts `{}`; the
 * server re-derives the reduced `daysPerWeek`, so the client can never forge a
 * target frequency). On `202` it reflects a regenerating state and navigates to
 * the C2 `PlanStatus` screen for the freshly generated plan id (which polls the
 * generating → ready transition). Dismiss is a pure no-op that hides the banner
 * and leaves the plan unchanged — no request is made.
 *
 * Result mapping (plan unchanged on every failure):
 *   - `403` → the shared `adaptation.quotaExhausted` upgrade copy;
 *   - `409` (`no_adaptation`, the recommendation went stale/recovered) → the
 *     `adaptation.upToDate` copy;
 *   - `sessionExpired` (401 / missing token) → clear the stored token and reset
 *     navigation to Login exactly once (mirrors `HomeScreen` / `PlanStatusScreen`);
 *   - anything else (network, unknown API error) → the generic `adaptation.error`.
 *
 * Double-submit safety: an `inFlightRef` guard + a disabled accept button mean a
 * rapid double-tap fires EXACTLY one `adaptPlan` (one `plan_regeneration`
 * consume), mirroring the web banner's in-flight disable. The guard is released
 * on a failure so the user can retry; on success the screen navigates away.
 *
 * Architecture — presentational glue: ALL network/result-mapping lives in the
 * injected C1 client; this component owns only the small accept state machine
 * and the nav wiring. Copy reuses the shared `adaptation.*` i18n namespace
 * (EN/ES parity shipped in B2) — no mobile-only copy fork.
 */

import React, { useCallback, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useIntl } from "react-intl";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { AdaptationRecommendation } from "@kinora/contracts";

import { deleteSessionToken } from "../auth/session-storage";
import {
  adaptPlan as defaultAdaptPlan,
  type ClientOptions,
  type GenerateResult,
} from "../api/plan-status-client";
import { styles } from "./AdherenceBanner.styles";

type AdaptPlanFn = (
  specId: string,
  options?: ClientOptions,
) => Promise<GenerateResult>;

interface AdherenceBannerProps {
  /** The dashboard read's adaptation recommendation (from `HomeScreen`). */
  adaptation?: AdaptationRecommendation;
  navigation: NativeStackNavigationProp<any>;
  /** Confirm client — defaults to the real C1 module; injected in tests. */
  adaptPlan?: AdaptPlanFn;
  /** Clear the stored session on expiry — defaults to `deleteSessionToken`. */
  clearSession?: () => Promise<void>;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
}

type Phase =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "regenerating" }
  | { kind: "error"; copyKey: "quotaExhausted" | "upToDate" | "error" };

/** Map a confirm failure to a distinct, coaching-tone `adaptation.*` copy key. */
function errorCopyKey(
  result: Extract<GenerateResult, { kind: "error" }>,
): "quotaExhausted" | "upToDate" | "error" {
  if (result.status === 403) return "quotaExhausted";
  if (result.status === 409) return "upToDate";
  return "error";
}

export default function AdherenceBanner({
  adaptation,
  navigation,
  adaptPlan,
  clearSession,
  apiBaseUrl,
  getToken,
}: AdherenceBannerProps) {
  const intl = useIntl();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [dismissed, setDismissed] = useState(false);

  // Stable, ref-captured deps so the client/navigation objects can change
  // identity across renders without re-creating callbacks.
  const adaptRef = useRef<AdaptPlanFn>(adaptPlan ?? defaultAdaptPlan);
  adaptRef.current = adaptPlan ?? defaultAdaptPlan;
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const clearSessionRef = useRef(clearSession ?? deleteSessionToken);
  clearSessionRef.current = clearSession ?? deleteSessionToken;

  const clientOptions: ClientOptions = { apiBaseUrl, getToken };

  const mountedRef = useRef(true);
  React.useEffect(() => {
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

  // Synchronous guard so a rapid double-tap fires EXACTLY one adaptPlan (one
  // quota consume) — the closure-captured `phase` cannot update between two
  // taps in the same tick, so a ref is the reliable gate.
  const inFlightRef = useRef(false);

  const change = adaptation?.suggestedChange;
  const planSpecId = adaptation?.planSpecId;

  const handleAccept = useCallback(async () => {
    if (inFlightRef.current || !planSpecId) return;
    inFlightRef.current = true;
    setPhase({ kind: "submitting" });

    const result = await adaptRef.current(planSpecId, clientOptions);
    if (!mountedRef.current) return;

    if (result.kind === "error") {
      inFlightRef.current = false; // allow a retry — the plan is unchanged
      if (result.sessionExpired) {
        routeToLogin();
        return;
      }
      setPhase({ kind: "error", copyKey: errorCopyKey(result) });
      return;
    }

    // 202 → a fresh generating plan; reflect a regenerating state and hand off
    // to the C2 plan-status screen, which polls this new plan id to ready.
    setPhase({ kind: "regenerating" });
    navigationRef.current.navigate("PlanStatus", { planId: result.planId });
    // clientOptions is derived from stable props; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planSpecId, routeToLogin]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  /* ── Gating ── */
  const show =
    !dismissed &&
    adaptation?.level === "low" &&
    (change?.kind === "reduce_frequency" || change?.kind === "adjust_load") &&
    typeof planSpecId === "string";

  if (!show || !change) return null;

  const isBusy = phase.kind === "submitting" || phase.kind === "regenerating";

  // 14b-v1.1 Slice B: an `adjust_load` recommendation (RPE-driven) branches to
  // distinct copy — no from/to day counts, since `intensityBias` steps one
  // rung on a `reduce < maintain < increase` ladder rather than a numeric
  // day count. `reduce_frequency` keeps its existing title/suggestion/accept
  // keys unchanged.
  const isLoadChange = change.kind === "adjust_load";
  const isDecrease = isLoadChange && change.direction === "decrease";
  const titleKey = isLoadChange ? "adaptation.rpe.title" : "adaptation.title";
  const bodyKey = isLoadChange
    ? isDecrease
      ? "adaptation.rpe.reduceLoad"
      : "adaptation.rpe.increaseLoad"
    : "adaptation.suggestion";
  const acceptKey = isLoadChange
    ? isDecrease
      ? "adaptation.rpe.acceptReduce"
      : "adaptation.rpe.acceptIncrease"
    : "adaptation.accept";

  if (phase.kind === "regenerating") {
    return (
      <View style={styles.card} testID="adherence-regenerating" accessibilityLiveRegion="polite">
        <Text style={styles.pending}>
          {intl.formatMessage({ id: "adaptation.regenerating" })}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="adherence-banner">
      <Text style={styles.eyebrow}>
        {intl.formatMessage({ id: titleKey })}
      </Text>
      <Text style={styles.body}>
        {isLoadChange
          ? intl.formatMessage({ id: bodyKey })
          : intl.formatMessage(
              { id: bodyKey },
              { fromDays: change.fromDays, toDays: change.toDays },
            )}
      </Text>

      <View style={styles.actions}>
        <Pressable
          testID="adherence-accept"
          style={({ pressed }) => [
            styles.acceptButton,
            pressed && styles.acceptButtonPressed,
            isBusy && styles.acceptButtonDisabled,
          ]}
          disabled={isBusy}
          onPress={handleAccept}
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy }}
          accessibilityLabel={
            isLoadChange
              ? intl.formatMessage({ id: acceptKey })
              : intl.formatMessage({ id: acceptKey }, { toDays: change.toDays })
          }
        >
          {phase.kind === "submitting" ? (
            <ActivityIndicator color={styles.acceptText.color} />
          ) : (
            <Text style={styles.acceptText}>
              {isLoadChange
                ? intl.formatMessage({ id: acceptKey })
                : intl.formatMessage({ id: acceptKey }, { toDays: change.toDays })}
            </Text>
          )}
        </Pressable>

        <Pressable
          testID="adherence-dismiss"
          style={({ pressed }) => [
            styles.dismissButton,
            pressed && styles.dismissButtonPressed,
          ]}
          disabled={isBusy}
          onPress={handleDismiss}
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy }}
          accessibilityLabel={intl.formatMessage({ id: "adaptation.dismiss" })}
        >
          <Text style={styles.dismissText}>
            {intl.formatMessage({ id: "adaptation.dismiss" })}
          </Text>
        </Pressable>
      </View>

      {phase.kind === "submitting" ? (
        <Text style={styles.pending} accessibilityLiveRegion="polite">
          {intl.formatMessage({ id: "adaptation.submitting" })}
        </Text>
      ) : null}

      {phase.kind === "error" ? (
        <Text style={styles.error} testID="adherence-error" accessibilityRole="alert">
          {intl.formatMessage({ id: `adaptation.${phase.copyKey}` })}
        </Text>
      ) : null}
    </View>
  );
}
