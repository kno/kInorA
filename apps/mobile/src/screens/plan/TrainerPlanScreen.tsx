/**
 * TrainerPlanScreen — mobile client-facing branded-plan view
 * (15b-v2-trainer-dashboard-branding, Phase S5).
 *
 * Fetches the caller's own trainer-built plan via the C1 `fetchTrainerPlan`
 * client (`GET /me/trainer-plan`, authorized by the S2
 * `resolveClientTrainerTenant` primitive) and renders three states:
 *   - "denied" — the fetch failed (a 403 with no active trainer assignment,
 *     or any other error). The S2 deny-by-default authorization is never
 *     weakened here — this screen renders whatever the API decided.
 *   - "pending" — the assignment exists but the plan isn't "ready" yet
 *     (generating/failed). No regenerate CTA — that stays trainer-controlled,
 *     out of this minimal client view's scope.
 *   - "ready" — the branded plan summary, reusing the SAME branding-render
 *     conventions `PlanStatusScreen`'s ready state established in S4 (title/
 *     trainerName byline/accent-themed session count).
 *
 * Intentionally minimal (design.md: "not a full client dashboard") — no
 * poll loop, no regenerate/adapt actions, no tracker wiring.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";

import {
  fetchTrainerPlan as defaultFetchTrainerPlan,
  type ClientOptions,
  type FetchPlanStatusResult,
  type PlanStatus,
} from "../../api/plan-status-client";
import { messages as M, trainerPlanMessages as TM } from "./messages";
import { styles } from "./PlanStatusScreen.styles";

/** The single C1 client call the screen depends on — injectable for tests. */
interface TrainerPlanClientApi {
  fetchTrainerPlan: (options?: ClientOptions) => Promise<FetchPlanStatusResult>;
}

export interface TrainerPlanScreenProps {
  /** Trainer-plan client — defaults to the real C1 module; injected in tests. */
  client?: Partial<TrainerPlanClientApi>;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
}

type Phase = "loading" | "denied" | "pending" | "ready";

export default function TrainerPlanScreen({
  client,
  apiBaseUrl,
  getToken,
}: TrainerPlanScreenProps) {
  const intl = useIntl();

  const [phase, setPhase] = useState<Phase>("loading");
  const [plan, setPlan] = useState<PlanStatus | undefined>();

  // Stable, ref-captured dep so the client object can change identity across
  // renders without re-creating the load callback.
  const clientRef = useRef<TrainerPlanClientApi>({
    fetchTrainerPlan: client?.fetchTrainerPlan ?? defaultFetchTrainerPlan,
  });
  clientRef.current = {
    fetchTrainerPlan: client?.fetchTrainerPlan ?? defaultFetchTrainerPlan,
  };

  const clientOptions: ClientOptions = { apiBaseUrl, getToken };

  // Mount status — every post-await `setState` is guarded so a late fetch
  // (a navigate-away mid-request) never writes into a torn-down tree.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!mountedRef.current) return;
    setPhase("loading");

    const result = await clientRef.current.fetchTrainerPlan(clientOptions);
    if (!mountedRef.current) return;
    if (result.kind === "error") {
      // Every error (403 no assignment, 404-mapped no_session, network,
      // etc.) surfaces as the SAME denied state — this minimal view never
      // branches on the S2 authorization's specific failure reason.
      setPhase("denied");
      return;
    }

    setPlan(result.plan);
    setPhase(result.plan.status === "ready" ? "ready" : "pending");
    // clientOptions is derived from stable props; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Render ── */

  if (phase === "loading") {
    return (
      <View style={styles.centered} testID="trainer-plan-loading">
        <ActivityIndicator color={styles.sessionCount.color} />
        <Text style={styles.body}>
          <FormattedMessage {...M.loading} />
        </Text>
      </View>
    );
  }

  if (phase === "denied") {
    return (
      <View style={styles.centered} testID="trainer-plan-denied">
        <Text style={styles.title}>
          <FormattedMessage {...TM.deniedTitle} />
        </Text>
        <Text style={styles.body}>
          <FormattedMessage {...TM.deniedBody} />
        </Text>
      </View>
    );
  }

  if (phase === "pending") {
    return (
      <View style={styles.centered} testID="trainer-plan-pending">
        <Text style={styles.title}>
          <FormattedMessage {...TM.pendingTitle} />
        </Text>
        <Text style={styles.body}>
          <FormattedMessage {...TM.pendingBody} />
        </Text>
      </View>
    );
  }

  /* ── Ready ── */
  const sessions = plan?.program?.weeklySessions ?? [];
  // Reuses the S4 accent-only theming seam: `branding.accentColor` overrides
  // the static `colors.accent` token on the accent-themed surfaces (session
  // count) when present; absent branding leaves the base token untouched.
  const branding = plan?.branding;
  const accentOverride = branding?.accentColor ? { color: branding.accentColor } : null;
  return (
    <View style={styles.screen} testID="trainer-plan-ready">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>
          {branding?.title ?? plan?.name ?? intl.formatMessage(M.readyTitle)}
        </Text>
        {branding?.trainerName && (
          <Text style={styles.body} testID="branding-byline">
            <FormattedMessage {...M.brandedBy} values={{ trainerName: branding.trainerName }} />
          </Text>
        )}
        <Text style={[styles.sessionCount, accentOverride]} testID="ready-sessions">
          <FormattedMessage {...M.readySessions} values={{ count: sessions.length }} />
        </Text>

        {sessions.map((session, index) => (
          <View key={index} style={styles.sessionRow} testID="session-row">
            <Text style={styles.sessionTitle}>{session.title}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
