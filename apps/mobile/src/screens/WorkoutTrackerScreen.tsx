/**
 * WorkoutTrackerScreen — live in-session workout tracker (native).
 *
 * Faithfully implements the Open Design mockup `screens/mobile-tracker.html`
 * with React Native primitives: session header (elapsed timer + pause),
 * segmented progress, current-exercise card with Carga/Reps steppers and a
 * "Completar serie" CTA, an SVG rest-timer ring, an "A continuación" preview,
 * and a "Finalizar sesión" row.
 *
 * Architecture: all math/branching lives in `tracker/tracker-logic.ts` (pure,
 * unit-tested) and the data layer in `api/workout-session.ts`; this component
 * is the thin CONTAINER that wires them to state, timers, and the API, then
 * composes the presentational children in `tracker/` (SessionHeader,
 * SessionProgress, ExerciseCard, RestCard, NextExercisePreview, FinishRow) —
 * the same "tested pure core + thin glue" pattern used across the mobile app
 * and mirroring the web tracker's decomposition.
 *
 * Copy comes from the shared `@kinora/i18n` catalog via `useIntl()`: each
 * presentational child reads its own ids from `tracker/messages.ts`; the
 * container only formats the values it derives (the `objective` and next-
 * `detail` strings, which depend on domain logic) and the non-session states.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { FormattedMessage, useIntl } from "react-intl";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { WorkoutSessionRecord } from "@kinora/contracts";

import { colors, fonts, radius, spacing } from "../theme/tokens";
import {
  completeWorkoutSession,
  getWorkoutSession,
  recordWorkoutSet,
  startWorkoutSession,
} from "../api/workout-session";
import {
  computeElapsedSeconds,
  computeRestRemaining,
  deriveTrackerView,
  objectiveWeightFor,
  orderedSets,
  seedFromSet,
  segmentStates,
  stepReps,
  stepWeight,
} from "./tracker/tracker-logic";
import { messages as M } from "./tracker/messages";
import { SessionHeader } from "./tracker/SessionHeader";
import { SessionProgress } from "./tracker/SessionProgress";
import { ExerciseCard } from "./tracker/ExerciseCard";
import { RestCard } from "./tracker/RestCard";
import { NextExercisePreview } from "./tracker/NextExercisePreview";
import { FinishRow } from "./tracker/FinishRow";
import { deleteSessionToken } from "../auth/session-storage";

export type TrackerRouteParams = {
  sessionId?: string;
  planId?: string;
  day?: number;
};

type TrackerScreenProps = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{ Tracker: TrackerRouteParams }, "Tracker">;
};

const DEFAULT_REST_SECONDS = 90;
const REST_LOW_THRESHOLD = 15;

type ConflictState = { activePlanName?: string; activeDay: number | null };

export default function WorkoutTrackerScreen({
  navigation,
  route,
}: TrackerScreenProps) {
  const insets = useSafeAreaInsets();
  const intl = useIntl();
  const params = route.params ?? {};
  const { sessionId, planId, day } = params;

  const [session, setSession] = useState<WorkoutSessionRecord | undefined>();
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | undefined>();
  const [conflict, setConflict] = useState<ConflictState | undefined>();

  // Stepper values for the current set.
  const [weight, setWeight] = useState(0);
  const [reps, setReps] = useState(0);

  // Elapsed session timer (display only; pause freezes the display).
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);

  // Rest countdown: null when not resting.
  const [restRemaining, setRestRemaining] = useState<number | null>(null);
  const [restDuration, setRestDuration] = useState(DEFAULT_REST_SECONDS);

  const [submitting, setSubmitting] = useState(false);

  // Tracks mount status so async paths never setState after the screen is
  // unmounted (navigating back mid-request). Guarded before EVERY setState in
  // an async continuation below.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // A missing/expired token is unrecoverable by retrying the same tokenless
  // request — route to the auth flow instead of dead-ending in a retry loop.
  // Shared by every call site that can observe a `no_session` result.
  const handleUnauthenticatedSession = useCallback(async () => {
    await deleteSessionToken();
    if (!mountedRef.current) return;
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  }, [navigation]);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setErrorKey(undefined);
    setConflict(undefined);

    let result;
    if (sessionId) {
      result = await getWorkoutSession(sessionId);
    } else if (planId && typeof day === "number") {
      result = await startWorkoutSession(planId, day);
    } else {
      if (!mountedRef.current) return;
      setErrorKey("errorLoad");
      setLoading(false);
      return;
    }

    if (result.kind === "error" && result.message === "no_session") {
      await handleUnauthenticatedSession();
      return;
    }

    if (!mountedRef.current) return;
    if (result.kind === "ok") {
      setSession(result.session);
    } else if (result.message === "active_session_conflict") {
      setConflict({
        activePlanName: result.activePlanName,
        activeDay: result.activeDay ?? null,
      });
    } else {
      setErrorKey(sessionId ? "errorLoad" : "errorStart");
    }
    setLoading(false);
  }, [sessionId, planId, day, handleUnauthenticatedSession]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const view = useMemo(
    () => (session ? deriveTrackerView(session) : undefined),
    [session],
  );
  const segments = useMemo(
    () => (session ? segmentStates(session) : []),
    [session],
  );

  // Seed the steppers whenever the current set changes.
  const currentSetId = view?.currentSet?.id;
  useEffect(() => {
    if (view?.currentSet) {
      const seed = seedFromSet(view.currentSet);
      setWeight(seed.weightKg);
      setReps(seed.reps);
    }
    // Only re-seed when the identity of the current set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSetId]);

  // ── Wall-clock-anchored timers ──
  // Both the elapsed timer and the rest countdown reconcile against
  // `Date.now()` rather than counting `setInterval` ticks, so they stay
  // accurate across backgrounded/locked spans where RN throttles or suspends
  // JS timers. Pause bookkeeping lives in refs (no re-render churn); the pure
  // math lives in tracker-logic. Mirrors web's `use-session-timer`.
  const startedAt = session?.startedAt;
  const startMsRef = useRef<number>(Number.NaN);
  const elapsedPauseStartRef = useRef<number | null>(null);
  const elapsedPausedAccumRef = useRef(0);

  // Rest end target (wall-clock ms), plus its own pause accounting.
  const restEndsAtRef = useRef<number | null>(null);
  const restPauseStartRef = useRef<number | null>(null);
  const restPausedAccumRef = useRef(0);

  const reconcileElapsed = useCallback(() => {
    setElapsed(
      computeElapsedSeconds(startMsRef.current, Date.now(), {
        pausedAccumMs: elapsedPausedAccumRef.current,
        pauseStartMs: elapsedPauseStartRef.current,
      }),
    );
  }, []);

  const reconcileRest = useCallback(() => {
    if (restEndsAtRef.current == null) return;
    const remaining = computeRestRemaining(restEndsAtRef.current, Date.now(), {
      pausedAccumMs: restPausedAccumRef.current,
      pauseStartMs: restPauseStartRef.current,
    });
    if (remaining == null) {
      restEndsAtRef.current = null;
      restPauseStartRef.current = null;
      restPausedAccumRef.current = 0;
      setRestRemaining(null);
    } else {
      setRestRemaining(remaining);
    }
  }, []);

  // Re-seed and reconcile whenever the session's start arrives/changes.
  useEffect(() => {
    startMsRef.current = startedAt ? Date.parse(startedAt) : Number.NaN;
    reconcileElapsed();
  }, [startedAt, reconcileElapsed]);

  // Single ticker + AppState listener drives BOTH timers. The tick is only a
  // display refresh — the values come from wall-clock, so a throttled or
  // missed tick self-corrects on the next reconcile (including on resume).
  useEffect(() => {
    if (!startedAt) return;
    reconcileElapsed();
    reconcileRest();
    const id = setInterval(() => {
      reconcileElapsed();
      reconcileRest();
    }, 1000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        reconcileElapsed();
        reconcileRest();
      }
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [startedAt, reconcileElapsed, reconcileRest]);

  const isResting = restRemaining !== null;

  const handleTogglePause = useCallback(() => {
    const now = Date.now();
    if (elapsedPauseStartRef.current != null) {
      // Resuming: fold the just-finished pause into the accumulators.
      elapsedPausedAccumRef.current += now - elapsedPauseStartRef.current;
      elapsedPauseStartRef.current = null;
      if (restPauseStartRef.current != null) {
        restPausedAccumRef.current += now - restPauseStartRef.current;
        restPauseStartRef.current = null;
      }
      setPaused(false);
    } else {
      // Pausing: freeze both displays; the rest target shifts on resume so it
      // does not "catch up" for the paused span.
      elapsedPauseStartRef.current = now;
      if (restEndsAtRef.current != null) restPauseStartRef.current = now;
      setPaused(true);
    }
    reconcileElapsed();
    reconcileRest();
  }, [reconcileElapsed, reconcileRest]);

  const handleStepWeight = useCallback(
    (direction: 1 | -1) => setWeight((w) => stepWeight(w, direction)),
    [],
  );
  const handleStepReps = useCallback(
    (direction: 1 | -1) => setReps((r) => stepReps(r, direction)),
    [],
  );

  const handleCompleteSet = useCallback(async () => {
    if (!session || !view?.currentSet || submitting) return;
    const setId = view.currentSet.id;
    const restSeconds = view.currentExercise?.restSeconds ?? DEFAULT_REST_SECONDS;

    setSubmitting(true);
    const result = await recordWorkoutSet(session.id, setId, {
      completed: true,
      weightKg: weight,
      actualReps: reps,
    });
    if (!mountedRef.current) return;

    if (result.kind === "error" && result.message === "no_session") {
      setSubmitting(false);
      await handleUnauthenticatedSession();
      return;
    }

    setSubmitting(false);

    if (result.kind === "ok") {
      setErrorKey(undefined);
      setSession(result.session);
      // Start the rest timer, anchored to a wall-clock END target so it
      // survives backgrounding. If paused when the set is logged, freeze it.
      const now = Date.now();
      restEndsAtRef.current = now + restSeconds * 1000;
      restPausedAccumRef.current = 0;
      restPauseStartRef.current = paused ? now : null;
      setRestDuration(restSeconds);
      setRestRemaining(restSeconds);
    } else {
      setErrorKey("errorRecord");
    }
  }, [session, view, submitting, weight, reps, paused, handleUnauthenticatedSession]);

  const handleAddRestTime = useCallback(() => {
    if (restEndsAtRef.current == null) return;
    const now = Date.now();
    const pausedMs =
      restPausedAccumRef.current +
      (restPauseStartRef.current != null ? now - restPauseStartRef.current : 0);
    const currentRemainingMs = restEndsAtRef.current + pausedMs - now;
    const newRemainingMs = Math.min(currentRemainingMs + 15_000, 599_000);
    restEndsAtRef.current = now - pausedMs + newRemainingMs;
    const newRemainingSec = Math.ceil(newRemainingMs / 1000);
    // Grow the ring's denominator so the arc stays proportional (never > full).
    setRestDuration((d) => Math.max(d, newRemainingSec));
    setRestRemaining(newRemainingSec);
  }, []);

  const handleSkipRest = useCallback(() => {
    restEndsAtRef.current = null;
    restPauseStartRef.current = null;
    restPausedAccumRef.current = 0;
    setRestRemaining(null);
  }, []);

  const handleFinish = useCallback(async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    const result = await completeWorkoutSession(session.id);
    if (!mountedRef.current) return;

    if (result.kind === "error" && result.message === "no_session") {
      setSubmitting(false);
      await handleUnauthenticatedSession();
      return;
    }

    setSubmitting(false);
    if (result.kind === "ok") {
      setErrorKey(undefined);
      setSession(result.session);
    } else {
      setErrorKey("errorComplete");
    }
  }, [session, submitting, handleUnauthenticatedSession]);

  const goHome = useCallback(() => navigation.goBack(), [navigation]);

  /* ── Non-session states ── */

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={styles.stateText}>
          <FormattedMessage {...M.loading} />
        </Text>
      </View>
    );
  }

  if (conflict) {
    const conflictMsg =
      conflict.activePlanName && conflict.activeDay !== null
        ? M.conflictWithScope
        : conflict.activePlanName
          ? M.conflictWithPlan
          : M.conflictGeneric;
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={[styles.stateText, styles.conflictText]}>
          <FormattedMessage
            {...conflictMsg}
            values={{ planName: conflict.activePlanName, day: conflict.activeDay }}
          />
        </Text>
        <Pressable style={styles.secondaryBtn} onPress={goHome} accessibilityRole="button">
          <Text style={styles.secondaryBtnText}>
            <FormattedMessage {...M.backHome} />
          </Text>
        </Pressable>
      </View>
    );
  }

  if (errorKey && !session) {
    const errorMsg = errorKey === "errorLoad" ? M.errorLoad : M.errorStart;
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={[styles.stateText, styles.errorText]}>
          <FormattedMessage {...errorMsg} />
        </Text>
        <Pressable style={styles.secondaryBtn} onPress={loadSession} accessibilityRole="button">
          <Text style={styles.secondaryBtnText}>
            <FormattedMessage {...M.retry} />
          </Text>
        </Pressable>
      </View>
    );
  }

  if (!session || !view) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={styles.stateText}>
          <FormattedMessage {...M.errorLoad} />
        </Text>
      </View>
    );
  }

  if (view.isComplete) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <StatusBar style="light" />
        <Text style={styles.completeTitle}>
          <FormattedMessage {...M.sessionCompleteTitle} />
        </Text>
        <Text style={styles.stateText}>
          <FormattedMessage {...M.sessionCompleteBody} />
        </Text>
        <Pressable style={styles.secondaryBtn} onPress={goHome} accessibilityRole="button">
          <Text style={styles.secondaryBtnText}>
            <FormattedMessage {...M.backHome} />
          </Text>
        </Pressable>
      </View>
    );
  }

  /* ── Active session render ── */

  const current = view.currentExercise;
  // The objective is the plan's FIXED target for this set — never the live
  // stepper `weight` (which the user mutates while logging). Source the weight
  // from the set's prescribed `weightKg`; fall back to a reps-only objective
  // when the plan prescribes no weight.
  const objectiveWeight = objectiveWeightFor(view.currentSet);
  const objectiveReps = view.currentSet?.targetReps ?? String(reps);
  const objective = !current
    ? ""
    : objectiveWeight !== undefined
      ? intl.formatMessage(M.objectiveLabel, { weightKg: objectiveWeight, reps: objectiveReps })
      : intl.formatMessage(M.objectiveLabelNoWeight, { reps: objectiveReps });
  const restColor =
    restRemaining !== null && restRemaining <= REST_LOW_THRESHOLD
      ? colors.accent
      : colors.warning;

  // Next-exercise preview detail.
  const next = view.nextExercise;
  let nextDetail = "";
  if (next) {
    const nextSets = orderedSets(next);
    const firstSet = nextSets[0];
    const nextReps = firstSet?.targetReps ?? "—";
    if (firstSet?.weightKg !== undefined) {
      nextDetail = intl.formatMessage(M.nextDetail, {
        sets: nextSets.length,
        weightKg: firstSet.weightKg,
        reps: nextReps,
      });
    } else {
      nextDetail = intl.formatMessage(M.nextDetailNoWeight, {
        sets: nextSets.length,
        reps: nextReps,
      });
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + spacing[2],
          paddingBottom: insets.bottom + spacing[5],
        }}
      >
        <SessionHeader
          title={current?.title ?? ""}
          elapsed={elapsed}
          paused={paused}
          onTogglePause={handleTogglePause}
        />

        <SessionProgress
          currentExerciseNumber={view.currentExerciseNumber}
          exerciseCount={view.exerciseCount}
          percent={view.percent}
          segments={segments}
        />

        <ExerciseCard
          title={current?.title ?? ""}
          currentSetNumber={view.currentSetNumber}
          setsInCurrentExercise={view.setsInCurrentExercise}
          objective={objective}
          weight={weight}
          reps={reps}
          onStepWeight={handleStepWeight}
          onStepReps={handleStepReps}
          onCompleteSet={handleCompleteSet}
          isResting={isResting}
          submitting={submitting}
          showRecordError={errorKey === "errorRecord"}
        />

        {isResting && (
          <RestCard
            restRemaining={restRemaining ?? 0}
            restDuration={restDuration}
            restColor={restColor}
            onAddTime={handleAddRestTime}
            onSkip={handleSkipRest}
          />
        )}

        {next && <NextExercisePreview title={next.title} detail={nextDetail} />}

        <FinishRow
          onFinish={handleFinish}
          submitting={submitting}
          showCompleteError={errorKey === "errorComplete"}
        />
      </ScrollView>
    </View>
  );
}

/* ──────────────────────────────── Styles ──────────────────────────────── */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    gap: spacing[3],
  },
  stateText: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  conflictText: { color: colors.fg },
  errorText: { color: colors.danger },
  completeTitle: {
    color: colors.fg,
    fontFamily: fonts.displayBold,
    fontSize: 26,
    letterSpacing: -0.5,
    textAlign: "center",
  },

  /* Shared secondary button (state screens) */
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    borderRadius: radius.btn,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryBtnText: { color: colors.fg, fontSize: 15, fontFamily: fonts.bodySemiBold },
});
