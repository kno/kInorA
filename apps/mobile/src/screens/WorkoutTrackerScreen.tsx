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
 * is the thin container that wires them to state, timers, and the API — the
 * same "tested pure core + thin glue" pattern used across the mobile app.
 *
 * Copy comes from the shared `@kinora/i18n` catalog via `useIntl()` — 22 keys
 * reuse the web `tracker.*` namespace verbatim, 23 reuse the mobile-only
 * `mobileTracker.*` namespace authored in slice 9 (see `copy/__tests__/
 * tracker-migration.test.ts` for the full old-copy → catalog-key mapping).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { FormattedMessage, useIntl } from "react-intl";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, {
  Circle,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
} from "react-native-svg";
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
  formatCountdown,
  formatElapsed,
  formatWeight,
  objectiveWeightFor,
  orderedSets,
  seedFromSet,
  segmentStates,
  stepReps,
  stepWeight,
} from "./tracker/tracker-logic";
import { RestRing } from "./tracker/RestRing";
import { messages as M } from "./tracker/messages";
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

/* ─────────────────────────── Inline SVG icons ─────────────────────────── */

const PauseIcon = () => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Rect x={3} y={2} width={4} height={12} rx={1.5} fill={colors.muted} />
    <Rect x={9} y={2} width={4} height={12} rx={1.5} fill={colors.muted} />
  </Svg>
);
const PlayIcon = () => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Polygon points="3,2 14,8 3,14" fill={colors.muted} />
  </Svg>
);
const MinusIcon = () => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Line x1={3} y1={8} x2={13} y2={8} stroke={colors.fg} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);
const PlusIcon = () => (
  <Svg width={16} height={16} viewBox="0 0 16 16">
    <Line x1={8} y1={3} x2={8} y2={13} stroke={colors.fg} strokeWidth={2.2} strokeLinecap="round" />
    <Line x1={3} y1={8} x2={13} y2={8} stroke={colors.fg} strokeWidth={2.2} strokeLinecap="round" />
  </Svg>
);
const CheckIcon = () => (
  <Svg width={18} height={18} viewBox="0 0 18 18">
    <Polyline points="3,9 7.5,13.5 15,4" fill="none" stroke={colors.accentFg} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const PersonIcon = () => (
  <Svg width={22} height={22} viewBox="0 0 22 22">
    <Circle cx={11} cy={7} r={3} fill="none" stroke={colors.muted} strokeWidth={1.8} />
    <Path d="M5 19c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="none" stroke={colors.muted} strokeWidth={1.8} strokeLinecap="round" />
  </Svg>
);
const ChevronIcon = () => (
  <Svg width={18} height={18} viewBox="0 0 18 18">
    <Polyline points="7,4 13,9 7,14" fill="none" stroke={colors.muted} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const StopIcon = () => (
  <Svg width={15} height={15} viewBox="0 0 15 15">
    <Rect x={2} y={2} width={11} height={11} rx={2} fill="none" stroke={colors.danger} strokeWidth={2} />
  </Svg>
);

/* ──────────────────────────────── Stepper ─────────────────────────────── */

function Stepper(props: {
  label: string;
  value: string;
  unit: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel: string;
  incrementLabel: string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.stepperGroup}>
      <Text style={styles.stepperLabel}>{props.label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
          onPress={props.onDecrement}
          disabled={props.disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={props.decrementLabel}
          accessibilityState={{ disabled: !!props.disabled }}
        >
          <MinusIcon />
        </Pressable>
        <View style={styles.stepValueWrap}>
          <Text style={styles.stepValue}>{props.value}</Text>
          <Text style={styles.stepUnit}>{props.unit}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
          onPress={props.onIncrement}
          disabled={props.disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={props.incrementLabel}
          accessibilityState={{ disabled: !!props.disabled }}
        >
          <PlusIcon />
        </Pressable>
      </View>
    </View>
  );
}

/* ───────────────────────────────── Screen ─────────────────────────────── */

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
  // Referenced twice below (accessibility label + visible text) — hoisted so
  // the elapsed timer's 1s re-render only formats it once per tick.
  const elapsedLabel = intl.formatMessage(M.elapsedLabel);
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
        {/* SESSION HEADER */}
        <View style={styles.sessionHeader}>
          <View style={styles.sessionMeta}>
            <Text style={styles.sessionSubtitle}>
              <FormattedMessage {...M.sessionActiveEyebrow} />
            </Text>
            <Text style={styles.sessionTitle} numberOfLines={1}>
              {current?.title ?? ""}
            </Text>
          </View>
          <View style={styles.sessionRight}>
            <View
              style={styles.elapsedTimer}
              accessibilityLiveRegion="polite"
              accessibilityLabel={`${elapsedLabel} ${formatElapsed(elapsed)}`}
            >
              <Text style={styles.elapsedLabel}>{elapsedLabel}</Text>
              <Text style={styles.elapsedValue}>{formatElapsed(elapsed)}</Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.pauseBtn, pressed && styles.pauseBtnPressed]}
              onPress={handleTogglePause}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={
                paused ? intl.formatMessage(M.resumeLabel) : intl.formatMessage(M.pauseLabel)
              }
            >
              {paused ? <PlayIcon /> : <PauseIcon />}
            </Pressable>
          </View>
        </View>

        {/* PROGRESS */}
        <View style={styles.progressArea}>
          <View style={styles.progressInfo}>
            <Text style={styles.progressInfoLabel}>
              <FormattedMessage
                {...M.progressLabel}
                values={{ n: view.currentExerciseNumber, m: view.exerciseCount }}
              />
            </Text>
            <Text style={styles.progressInfoCount}>{view.percent}%</Text>
          </View>
          <View
            style={styles.segBar}
            accessibilityRole="progressbar"
            accessibilityValue={{
              text: intl.formatMessage(M.progressValueText, {
                n: view.currentExerciseNumber,
                m: view.exerciseCount,
                percent: view.percent,
              }),
            }}
            accessibilityLabel={intl.formatMessage(M.progressA11y, {
              current: view.currentExerciseNumber,
              total: view.exerciseCount,
            })}
          >
            {segments.map((state, i) => (
              <View
                key={i}
                style={[
                  styles.seg,
                  state === "done" && styles.segDone,
                  state === "active" && styles.segActive,
                ]}
              />
            ))}
          </View>
        </View>

        {/* CURRENT EXERCISE CARD */}
        <View style={styles.exerciseCard}>
          <View style={styles.cardTopAccent} />
          <Text style={styles.excardEyebrow}>
            <FormattedMessage {...M.currentExerciseEyebrow} />
          </Text>
          <Text style={styles.excardName}>{current?.title ?? ""}</Text>
          <Text style={styles.excardSetInfo}>
            <FormattedMessage
              {...M.setInfo}
              values={{
                setNumber: view.currentSetNumber,
                setTotal: view.setsInCurrentExercise,
                targetLabel: objective,
              }}
            />
          </Text>

          <View style={styles.steppersRow}>
            <Stepper
              label={intl.formatMessage(M.loadLabel)}
              value={formatWeight(weight)}
              unit={intl.formatMessage(M.loadUnit)}
              onDecrement={() => setWeight((w) => stepWeight(w, -1))}
              onIncrement={() => setWeight((w) => stepWeight(w, 1))}
              decrementLabel={intl.formatMessage(M.decreaseLoad)}
              incrementLabel={intl.formatMessage(M.increaseLoad)}
              disabled={isResting}
            />
            <Stepper
              label={intl.formatMessage(M.repsLabel)}
              value={String(reps)}
              unit={intl.formatMessage(M.repsUnit)}
              onDecrement={() => setReps((r) => stepReps(r, -1))}
              onIncrement={() => setReps((r) => stepReps(r, 1))}
              decrementLabel={intl.formatMessage(M.decreaseReps)}
              incrementLabel={intl.formatMessage(M.increaseReps)}
              disabled={isResting}
            />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.btnComplete,
              (isResting || submitting) && styles.btnCompleteDisabled,
              pressed && styles.btnCompletePressed,
            ]}
            onPress={handleCompleteSet}
            disabled={isResting || submitting}
            accessibilityRole="button"
            accessibilityLabel={intl.formatMessage(M.completeSetA11y, {
              setNumber: view.currentSetNumber,
            })}
            accessibilityState={{ disabled: isResting || submitting }}
          >
            <CheckIcon />
            <Text style={styles.btnCompleteText}>
              <FormattedMessage {...M.completeSet} />
            </Text>
          </Pressable>

          {errorKey === "errorRecord" && (
            <Text style={styles.inlineError} accessibilityRole="alert">
              <FormattedMessage {...M.errorRecord} />
            </Text>
          )}
        </View>

        {/* REST TIMER CARD */}
        {isResting && (() => {
          // Same skip label backs 3 spots in this card (top-right shortcut +
          // the bottom button's a11y label and its visible text) — one call.
          const skipRestLabel = intl.formatMessage(M.skipRest);
          return (
            <View
              style={styles.restCard}
              accessibilityLabel={intl.formatMessage(M.restA11y)}
              accessibilityLiveRegion="polite"
            >
              <View style={styles.restHeaderRow}>
                <View style={styles.restHeading}>
                  <View style={styles.restHeadingDot} />
                  <Text style={styles.restHeadingText}>
                    <FormattedMessage {...M.restActive} />
                  </Text>
                </View>
                <Pressable
                  style={styles.restSkipBtnTop}
                  onPress={handleSkipRest}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={skipRestLabel}
                >
                  <Text style={styles.restSkipBtnTopText}>
                    <FormattedMessage {...M.skip} />
                  </Text>
                </Pressable>
              </View>

              <View style={styles.ringWrap}>
                <RestRing
                  remaining={restRemaining ?? 0}
                  duration={restDuration}
                  strokeColor={restColor}
                />
                <View style={styles.ringCenter} pointerEvents="none">
                  <Text style={[styles.ringTime, { color: restColor }]}>
                    {formatCountdown(restRemaining ?? 0)}
                  </Text>
                  <Text style={styles.ringLabelSm}>
                    <FormattedMessage {...M.restLabelSm} />
                  </Text>
                </View>
              </View>

              <View style={styles.restActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.btnAddTime,
                    pressed && styles.btnAddTimePressed,
                  ]}
                  onPress={handleAddRestTime}
                  accessibilityRole="button"
                  accessibilityLabel={intl.formatMessage(M.addTimeA11y)}
                >
                  <Text style={styles.btnAddTimeText}>
                    <FormattedMessage {...M.addTime} />
                  </Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.btnSkip, pressed && styles.btnSkipPressed]}
                  onPress={handleSkipRest}
                  accessibilityRole="button"
                  accessibilityLabel={skipRestLabel}
                >
                  <Text style={styles.btnSkipText}>{skipRestLabel}</Text>
                </Pressable>
              </View>
            </View>
          );
        })()}

        {/* NEXT PREVIEW */}
        {next && (() => {
          // Used both as the card's a11y label and its visible eyebrow text.
          const nextEyebrow = intl.formatMessage(M.nextEyebrow);
          return (
            <View style={styles.nextPreview} accessibilityLabel={nextEyebrow}>
              <View style={styles.nextThumb}>
                <PersonIcon />
              </View>
              <View style={styles.nextInfo}>
                <Text style={styles.nextEyebrow}>{nextEyebrow}</Text>
                <Text style={styles.nextName} numberOfLines={1}>
                  {next.title}
                </Text>
                <Text style={styles.nextDetail}>{nextDetail}</Text>
              </View>
              <ChevronIcon />
            </View>
          );
        })()}

        {/* FINISH ROW */}
        <View style={styles.finishRow}>
          <Pressable
            style={({ pressed }) => [styles.btnFinish, pressed && styles.btnFinishPressed]}
            onPress={handleFinish}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={intl.formatMessage(M.finishSessionA11y)}
            accessibilityState={{ disabled: submitting }}
          >
            <StopIcon />
            <Text style={styles.btnFinishText}>
              <FormattedMessage {...M.finishSession} />
            </Text>
          </Pressable>
        </View>

        {errorKey === "errorComplete" && (
          <Text style={[styles.inlineError, styles.centeredError]} accessibilityRole="alert">
            <FormattedMessage {...M.errorComplete} />
          </Text>
        )}
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

  /* Session header */
  sessionHeader: {
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  sessionMeta: { flexDirection: "column", gap: 2, flexShrink: 1 },
  sessionSubtitle: { fontSize: 12, color: colors.muted, fontFamily: fonts.bodyMedium },
  sessionTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.fg,
    letterSpacing: -0.4,
  },
  sessionRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  elapsedTimer: { flexDirection: "column", alignItems: "flex-end" },
  elapsedLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
  },
  elapsedValue: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: colors.fg,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
  pauseBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pauseBtnPressed: { backgroundColor: colors.surface2 },

  /* Progress */
  progressArea: { paddingHorizontal: 20, paddingTop: spacing[3] },
  progressInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[1],
  },
  progressInfoLabel: { fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.fg },
  progressInfoCount: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.display,
    fontVariant: ["tabular-nums"],
  },
  segBar: { flexDirection: "row", gap: 4, height: 5 },
  seg: { flex: 1, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  segDone: { backgroundColor: colors.accent },
  segActive: { backgroundColor: colors.accentActive },

  /* Exercise card */
  exerciseCard: {
    marginHorizontal: 16,
    marginTop: spacing[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardLg,
    padding: 20,
    overflow: "hidden",
  },
  cardTopAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.accent,
  },
  excardEyebrow: {
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
    marginBottom: 6,
  },
  excardName: {
    fontFamily: fonts.displayBold,
    fontSize: 26,
    color: colors.fg,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  excardSetInfo: { fontSize: 13, color: colors.muted, fontFamily: fonts.body, marginBottom: 20 },

  steppersRow: { flexDirection: "row", gap: spacing[2], marginBottom: 20 },
  stepperGroup: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing[2],
    gap: 6,
  },
  stepperLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
    textAlign: "center",
  },
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnPressed: { backgroundColor: colors.border },
  stepValueWrap: { flex: 1, alignItems: "center" },
  stepValue: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.fg,
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  stepUnit: { fontSize: 13, color: colors.muted, fontFamily: fonts.body },

  btnComplete: {
    width: "100%",
    height: 54,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
  },
  btnCompletePressed: { opacity: 0.92 },
  btnCompleteDisabled: { opacity: 0.4 },
  btnCompleteText: { color: colors.accentFg, fontSize: 16, fontFamily: fonts.bodyBold },

  inlineError: { color: colors.danger, fontFamily: fonts.bodyMedium, fontSize: 13, marginTop: spacing[2] },
  centeredError: { textAlign: "center", marginHorizontal: 16 },

  /* Rest card */
  restCard: {
    marginHorizontal: 16,
    marginTop: spacing[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardLg,
    padding: 20,
    alignItems: "center",
    gap: spacing[3],
  },
  restHeaderRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  restHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  restHeadingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.warning },
  restHeadingText: { fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.fg },
  restSkipBtnTop: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  restSkipBtnTopText: { fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.muted },

  ringWrap: { width: 130, height: 130, alignItems: "center", justifyContent: "center" },
  ringCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  ringTime: {
    fontFamily: fonts.displayBold,
    fontSize: 32,
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  ringLabelSm: {
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontFamily: fonts.bodySemiBold,
  },

  restActions: { flexDirection: "row", gap: 10, width: "100%" },
  btnAddTime: {
    flex: 1,
    height: 44,
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radius.btn,
    alignItems: "center",
    justifyContent: "center",
  },
  btnAddTimePressed: { backgroundColor: colors.warningTintHover },
  btnAddTimeText: { color: colors.warning, fontSize: 14, fontFamily: fonts.bodySemiBold },
  btnSkip: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.btn,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSkipPressed: { backgroundColor: colors.border },
  btnSkipText: { color: colors.fg, fontSize: 14, fontFamily: fonts.bodySemiBold },

  /* Next preview */
  nextPreview: {
    marginHorizontal: 16,
    marginTop: spacing[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    opacity: 0.6,
  },
  nextThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  nextInfo: { flex: 1 },
  nextEyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
    marginBottom: 3,
  },
  nextName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.fg, letterSpacing: -0.2 },
  nextDetail: { fontSize: 13, color: colors.muted, fontFamily: fonts.body, marginTop: 2 },

  /* Finish row */
  finishRow: { marginHorizontal: 16, marginTop: spacing[2], alignItems: "center" },
  btnFinish: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  btnFinishPressed: { backgroundColor: colors.dangerTint },
  btnFinishText: { color: colors.danger, fontSize: 13, fontFamily: fonts.bodySemiBold },

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
