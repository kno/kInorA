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
 *
 * --- Phase 5 mobile offline (09b-v1) -----------------------------------------
 *
 * Mirrors the web tracker's offline design (`apps/web/.../use-workout-
 * session.ts`), adapted for AsyncStorage + NetInfo + a direct API client
 * (no Next.js Server Actions, so `STALE_ACTION` never applies here):
 *
 *  - Write-order invariant: `enqueueMutation` (durable AsyncStorage write)
 *    ALWAYS happens before the optimistic local-state/snapshot update.
 *  - Flush is gated on `ConnectivityMonitor.isOnline()` BEFORE anything
 *    network-shaped — offline writes enqueue+snapshot and return, no
 *    network call, ever.
 *  - Flush is strictly sequential (`runSequentialFlush`) with a
 *    reentrancy guard (`isFlushingRef`/`flushAgainRef`), mirroring the
 *    Judgment-Day-hardened web invariants.
 *  - `AUTH` (401/403) and poison-dropped (`VALIDATION`/`NOT_FOUND`)
 *    failures are surfaced via `syncNotice` — never silently lost.
 *  - The store/queue/snapshot are scoped by an identity key derived from
 *    `GET /auth/identity` (mobile has the Bearer token, so — unlike web —
 *    it resolves identity directly, no Server-Action indirection needed).
 *  - `handleUnauthenticatedSession` (mobile's only existing "session
 *    ended" hook) clears the CURRENT identity's queue+snapshot before
 *    navigating to Login — this app's clear-on-logout mechanism.
 *
 * Offline features degrade gracefully: any failure resolving identity /
 * opening the store / creating the connectivity monitor falls back to the
 * pre-offline direct-call behavior untouched (try/catch around every
 * offline-prep step).
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Pressable, ScrollView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { FormattedMessage, useIntl } from "react-intl";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { ConnectivityMonitor, WorkoutSessionRecord } from "@kinora/contracts";
import { collapseQueue } from "@kinora/domain";

import { colors, spacing } from "../theme/tokens";
import {
  completeWorkoutSession,
  getWorkoutSession,
  recordWorkoutSet,
  startWorkoutSession,
} from "../api/workout-session";
import { getAuthIdentity } from "../api/auth-identity";
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
import { styles } from "./WorkoutTrackerScreen.styles";
import type { OfflineStore } from "../offline/store";
import { openOfflineDb } from "../offline/async-storage-db";
import {
  clearIdentityScope,
  ensureIdentityScope,
  resolveIdentityKey,
} from "../offline/identity";
import { enqueueMutation, getQueuedMutations, removeMutation } from "../offline/queue";
import {
  applyOptimisticComplete,
  clearActiveSessionPointer,
  clearSnapshot,
  readActiveSessionPointer,
  readSnapshot,
  writeActiveSessionPointer,
  writeSnapshot,
} from "../offline/snapshot";
import { applyPendingMutation } from "../offline/apply-mutation";
import { runSequentialFlush } from "../offline/flush";

export type TrackerRouteParams = {
  sessionId?: string;
  planId?: string;
  day?: number;
};

/**
 * Injectable offline dependencies — mirrors web's
 * `UseWorkoutSessionOptions.offline` injection pattern. Defaults to the
 * real AsyncStorage/NetInfo/`GET /auth/identity` implementations; tests
 * inject an in-memory store + fake connectivity monitor + fake identity
 * resolver instead of mocking native modules directly (Mock Hygiene Rule).
 *
 * `createConnectivityMonitor` returns a Promise because the REAL
 * implementation dynamically imports `../offline/connectivity` — that
 * module statically imports `@react-native-community/netinfo`, which (like
 * `expo-crypto`) fails to even PARSE under vitest (Flow-typed React Native
 * internals) if imported at this file's top level. Deferring the import to
 * call time, inside this already-try/catch'd offline-prep block, means a
 * test environment that never injects a fake degrades gracefully instead of
 * crashing every test that imports this screen — the same "resolve at call
 * time, not at module-eval time" lesson web's `defaultOfflineDeps` fix
 * documents.
 */
export interface OfflineDeps {
  getIdentityKey: () => Promise<string | undefined>;
  openStore: () => Promise<OfflineStore>;
  createConnectivityMonitor: () => Promise<ConnectivityMonitor>;
}

const defaultOfflineDeps: OfflineDeps = {
  getIdentityKey: () => resolveIdentityKey({ getIdentity: () => getAuthIdentity() }),
  openStore: () => openOfflineDb(),
  createConnectivityMonitor: async () => {
    const { createConnectivityMonitor } = await import("../offline/connectivity");
    return createConnectivityMonitor();
  },
};

type TrackerScreenProps = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<{ Tracker: TrackerRouteParams }, "Tracker">;
  offline?: OfflineDeps;
};

const DEFAULT_REST_SECONDS = 90;
const REST_LOW_THRESHOLD = 15;

type ConflictState = { activePlanName?: string; activeDay: number | null };

interface OfflineContext {
  store: OfflineStore;
  identityKey: string;
}

export default function WorkoutTrackerScreen({
  navigation,
  route,
  offline,
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
  // Synchronous mirror of `submitting`, checked by handleCompleteSet /
  // handleFinish's top-of-function re-entrancy guard. `setSubmitting` alone
  // is NOT enough: React state updates are not visible to a closure until
  // the next render, so two SYNCHRONOUS taps (both invoking the exact same
  // memoized callback, before either yields to a re-render) would both read
  // the same stale `submitting === false` and both pass the guard — this ref
  // is set/cleared eagerly, in lockstep with `setSubmitting`, so the second
  // synchronous tap sees the guard flip immediately.
  const submittingRef = useRef(false);

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

  const [syncNotice, setSyncNotice] = useState<"auth_required" | "dropped" | undefined>();

  const offlineDeps = offline ?? defaultOfflineDeps;
  const offlineRef = useRef<OfflineContext | undefined>(undefined);
  // Flush reentrancy guard (mirrors web's Judgment Day fix #1): `flush` can
  // be invoked from multiple triggers (connectivity reconnect, end of
  // handleCompleteSet, handleFinish) with no coordination between them.
  // While a flush is in-flight, a second trigger only marks "run again once
  // this pass finishes" — never starts a second concurrent pass.
  const isFlushingRef = useRef(false);
  const flushAgainRef = useRef(false);
  const connectivityRef = useRef<ConnectivityMonitor | undefined>(undefined);
  const connectivityUnsubscribeRef = useRef<(() => void) | undefined>(undefined);

  // A missing/expired token is unrecoverable by retrying the same tokenless
  // request — route to the auth flow instead of dead-ending in a retry loop.
  // Shared by every call site that can observe a `no_session` result. Also
  // this app's ONLY existing "session ended" hook (no dedicated Logout
  // screen exists), so it doubles as the clear-on-logout mechanism for the
  // offline store: the CURRENT identity's queue+snapshot are purged before
  // navigating away, so a stale queue never flushes under a different
  // account's token after a subsequent login.
  const handleUnauthenticatedSession = useCallback(async () => {
    const ctx = offlineRef.current;
    if (ctx) {
      try {
        await clearIdentityScope(ctx.store, ctx.identityKey);
      } catch {
        // Best-effort — never block the sign-out redirect on this.
      }
      offlineRef.current = undefined;
    }
    connectivityUnsubscribeRef.current?.();
    connectivityUnsubscribeRef.current = undefined;
    connectivityRef.current = undefined;

    await deleteSessionToken();
    if (!mountedRef.current) return;
    navigation.reset({ index: 0, routes: [{ name: "Login" }] });
  }, [navigation]);

  // One flush PASS: reads the current queue, runs it sequentially, applies
  // the outcome. Extracted so the reentrancy guard can re-run it exactly
  // once more after an in-flight pass settles, without duplicating the body.
  const runFlushPass = useCallback(async () => {
    const ctx = offlineRef.current;
    if (!ctx) return;

    // Gate the ENTIRE pass on connectivity BEFORE doing anything
    // network-shaped — offline writes must enqueue+snapshot and return
    // without ever touching the network.
    const monitor = connectivityRef.current;
    if (monitor && !monitor.isOnline()) return;

    const queued = await getQueuedMutations(ctx.store, ctx.identityKey);
    if (queued.length === 0) {
      // A clean empty-queue pass means every previously-queued mutation is
      // accounted for — a transient `auth_required` prompt self-clears;
      // `dropped` stays sticky (permanent data loss, remains true
      // regardless of the queue's current state).
      setSyncNotice((prev) => (prev === "dropped" ? prev : undefined));
      return;
    }

    const collapsed = collapseQueue(queued);

    const summary = await runSequentialFlush(collapsed, async (mutation) => {
      try {
        const result =
          mutation.kind === "complete"
            ? await completeWorkoutSession(mutation.sessionId)
            : await recordWorkoutSet(mutation.sessionId, mutation.setId, mutation.input);

        if (result.kind === "ok") return { kind: "ok", session: result.session };
        if (result.message === "no_session") {
          return { kind: "error", code: "AUTH" };
        }
        return { kind: "error", code: result.code };
      } catch {
        return { kind: "error", code: "UNREACHABLE" };
      }
    });

    for (const mutation of [...summary.synced, ...summary.dropped]) {
      await removeMutation(ctx.store, ctx.identityKey, mutation.clientSeq);
    }

    if (summary.lastAckedSession) {
      const acked = summary.lastAckedSession;
      await writeSnapshot(ctx.store, ctx.identityKey, acked.id, acked);
      if (mountedRef.current) {
        setSession((prev) => (prev?.id === acked.id ? acked : prev));
      }

      if (acked.status === "completed" && summary.remaining.length === 0) {
        await clearSnapshot(ctx.store, ctx.identityKey, acked.id);
        await clearActiveSessionPointer(ctx.store, ctx.identityKey);
      }
    }

    // A poison-drop (VALIDATION/NOT_FOUND) MUST surface to the user, never
    // just silently empty the queue. Priority: auth (session expired
    // mid-flush, still queued) > dropped (permanently lost, poison message).
    if (!mountedRef.current) return;
    if (summary.haltCode === "AUTH") {
      setSyncNotice("auth_required");
    } else if (summary.dropped.length > 0) {
      setSyncNotice("dropped");
    } else {
      setSyncNotice(undefined);
    }
  }, []);

  const flush = useCallback(async () => {
    if (isFlushingRef.current) {
      flushAgainRef.current = true;
      return;
    }
    isFlushingRef.current = true;
    try {
      do {
        flushAgainRef.current = false;
        try {
          await runFlushPass();
        } catch {
          // Every caller invokes `flush()` fire-and-forget (`void flush()`)
          // from a synchronous event handler — a rejection here would
          // surface as an unhandled promise rejection on the mainline
          // offline write path. A transient failure (storage I/O, an
          // unexpected throw from the API client) must never propagate:
          // the queue itself is untouched by a failed pass, so it stays
          // intact and the NEXT trigger (reconnect, next enqueue) retries.
        }
      } while (flushAgainRef.current);
    } finally {
      isFlushingRef.current = false;
    }
  }, [runFlushPass]);

  const loadSession = useCallback(async () => {
    setLoading(true);
    setErrorKey(undefined);
    setConflict(undefined);

    // Resolve/prepare the offline context (best-effort — degrades to the
    // pre-offline direct-call behavior on ANY failure: no session, no
    // store, connectivity monitor unavailable, etc).
    if (!offlineRef.current) {
      try {
        const identityKey = await offlineDeps.getIdentityKey();
        if (identityKey && mountedRef.current) {
          const store = await offlineDeps.openStore();
          await ensureIdentityScope(store, identityKey);
          offlineRef.current = { store, identityKey };

          const monitor = await offlineDeps.createConnectivityMonitor();
          connectivityRef.current = monitor;
          connectivityUnsubscribeRef.current = monitor.subscribe((online) => {
            if (online) void flush();
          });

          // Offline restart hydration: if we're offline right now and a
          // cached snapshot exists for the target session, render directly
          // from the snapshot + any still-queued mutations replayed on top
          // — WITHOUT any network call.
          if (!monitor.isOnline()) {
            const pointerSessionId =
              sessionId ?? (await readActiveSessionPointer(store, identityKey));
            if (pointerSessionId) {
              const snapshot = await readSnapshot(store, identityKey, pointerSessionId);
              if (snapshot) {
                const queued = await getQueuedMutations(store, identityKey);
                const collapsed = collapseQueue(queued);
                const hydrated = collapsed.reduce(applyPendingMutation, snapshot.session);
                if (mountedRef.current) {
                  setSession(hydrated);
                  setLoading(false);
                }
                return;
              }
            }
          }
        }
      } catch {
        // Offline features are best-effort — fall through to the normal
        // network-based load below.
      }
    }

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
      const ctx = offlineRef.current;
      if (ctx) {
        try {
          await writeSnapshot(ctx.store, ctx.identityKey, result.session.id, result.session);
          await writeActiveSessionPointer(ctx.store, ctx.identityKey, result.session.id);
        } catch {
          // Best-effort — the session still rendered from the network response.
        }
      }
    } else if (result.message === "active_session_conflict") {
      setConflict({
        activePlanName: result.activePlanName,
        activeDay: result.activeDay ?? null,
      });
    } else {
      setErrorKey(sessionId ? "errorLoad" : "errorStart");
    }
    setLoading(false);
  }, [sessionId, planId, day, handleUnauthenticatedSession, offlineDeps, flush]);

  useEffect(() => {
    void loadSession();
    return () => {
      connectivityUnsubscribeRef.current?.();
    };
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
    if (!session || !view?.currentSet || submitting || submittingRef.current) return;
    const setId = view.currentSet.id;
    const restSeconds = view.currentExercise?.restSeconds ?? DEFAULT_REST_SECONDS;
    const sessionId = session.id;
    const input = { completed: true, weightKg: weight, actualReps: reps };

    const startRestTimer = () => {
      // Start the rest timer, anchored to a wall-clock END target so it
      // survives backgrounding. If paused when the set is logged, freeze it.
      const now = Date.now();
      restEndsAtRef.current = now + restSeconds * 1000;
      restPausedAccumRef.current = 0;
      restPauseStartRef.current = paused ? now : null;
      setRestDuration(restSeconds);
      setRestRemaining(restSeconds);
    };

    // Re-entrancy guard: `submittingRef` flips SYNCHRONOUSLY (unlike
    // `setSubmitting`, which only takes effect on the next render) before
    // the first `await` in EITHER branch below (offline and online) — so a
    // rapid double-tap's second, synchronous invocation is rejected by the
    // top-of-function guard before it can read a not-yet-updated local
    // snapshot and clobber the first tap's optimistic write.
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const ctx = offlineRef.current;
      if (ctx) {
        // Offline-safe path: durably ENQUEUE first (write-order invariant —
        // a crash before the snapshot write is self-healing via replay), then
        // optimistically apply the mutation to local UI + the cached
        // snapshot, then attempt an immediate flush (no-ops while offline).
        try {
          const mutation = await enqueueMutation(ctx.store, ctx.identityKey, {
            kind: "set",
            sessionId,
            setId,
            input,
            queuedAt: Date.now(),
          });

          if (mountedRef.current) {
            setSession((prev) => (prev && prev.id === sessionId ? applyPendingMutation(prev, mutation) : prev));
          }

          const snapshot = await readSnapshot(ctx.store, ctx.identityKey, sessionId);
          const base = snapshot?.session ?? session;
          await writeSnapshot(ctx.store, ctx.identityKey, sessionId, applyPendingMutation(base, mutation));

          if (mountedRef.current) {
            setErrorKey(undefined);
            startRestTimer();
          }
          void flush();
          return;
        } catch {
          // Offline module unavailable — degrade to the direct-call path below.
        }
      }

      const result = await recordWorkoutSet(sessionId, setId, input);
      if (!mountedRef.current) return;

      if (result.kind === "error" && result.message === "no_session") {
        await handleUnauthenticatedSession();
        return;
      }

      if (result.kind === "ok") {
        setErrorKey(undefined);
        setSession(result.session);
        startRestTimer();
      } else {
        setErrorKey("errorRecord");
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, [session, view, submitting, weight, reps, paused, handleUnauthenticatedSession, flush]);

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
    if (!session || submitting || submittingRef.current) return;
    const sessionId = session.id;

    // Re-entrancy guard: `submittingRef` flips SYNCHRONOUSLY (unlike
    // `setSubmitting`, which only takes effect on the next render) before
    // the first `await` in EITHER branch below (offline and online) —
    // mirrors `handleCompleteSet`'s fix, so a rapid double-tap on
    // "Finalizar sesión" is rejected by the top-of-function guard instead of
    // racing two enqueue/snapshot cycles.
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const ctx = offlineRef.current;
      if (ctx) {
        try {
          // Enqueue-first (durable), then optimistically flip the cached
          // snapshot's session.status to "completed" — so an offline restart
          // before ack still renders as completed.
          await enqueueMutation(ctx.store, ctx.identityKey, {
            kind: "complete",
            sessionId,
            queuedAt: Date.now(),
          });

          const snapshot = await readSnapshot(ctx.store, ctx.identityKey, sessionId);
          if (snapshot) {
            await writeSnapshot(
              ctx.store,
              ctx.identityKey,
              sessionId,
              applyOptimisticComplete(snapshot).session,
            );
          }

          if (mountedRef.current) {
            setErrorKey(undefined);
            setSession((prev) => (prev && prev.id === sessionId ? { ...prev, status: "completed" } : prev));
          }
          void flush();
          return;
        } catch {
          // Offline module unavailable — degrade to the direct-call path below.
        }
      }

      const result = await completeWorkoutSession(sessionId);
      if (!mountedRef.current) return;

      if (result.kind === "error" && result.message === "no_session") {
        await handleUnauthenticatedSession();
        return;
      }

      if (result.kind === "ok") {
        setErrorKey(undefined);
        setSession(result.session);
      } else {
        setErrorKey("errorComplete");
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, [session, submitting, handleUnauthenticatedSession, flush]);

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

        {syncNotice && (
          <Text
            style={[styles.stateText, styles.errorText]}
            accessibilityRole="alert"
            testID="tracker-sync-notice"
          >
            <FormattedMessage
              {...(syncNotice === "auth_required" ? M.syncAuthRequired : M.syncDropped)}
            />
          </Text>
        )}

        <FinishRow
          onFinish={handleFinish}
          submitting={submitting}
          showCompleteError={errorKey === "errorComplete"}
        />
      </ScrollView>
    </View>
  );
}
