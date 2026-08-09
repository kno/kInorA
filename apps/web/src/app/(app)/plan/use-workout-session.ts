"use client";

/**
 * useWorkoutSession — shared inline-tracker state machine (#93 Slice 3).
 *
 * Both `PlanTrackerClient` (the `/plan` tab) and `PlanStatusClient`
 * (`/plan/[id]`) drive the SAME start/record/complete lifecycle against the
 * reused `/plan/[id]` server actions. This hook is the single source of truth
 * for that lifecycle so the three review-flagged bugs are fixed ONCE:
 *
 *   1. Completion dead-end — after `completeWorkoutSessionAction` returns a
 *      `completed` session there is no navigation escape on `/plan` (the tracker
 *      is a full state-swap). We clear `activeSession` on a successful complete
 *      so the plan/day view returns; the completed session is persisted
 *      server-side, so nothing is lost. Clearing in-memory state only fixes
 *      the CURRENT tab, though — the persisted active-session pointer
 *      outlives it. See "Terminal-pointer recovery" below (#398).
 *   2. Unhandled throw — `startWorkoutSessionAction` /
 *      `recordWorkoutSetAction` / `completeWorkoutSessionAction` THROW on
 *      non-conflict failures (network / not_found / invalid_response). Awaiting
 *      them without a guard surfaces as an unhandled rejection that crashes the
 *      render. Every handler is wrapped in try/catch and stores an `error`
 *      string the consumer renders as an inline `role="alert"`.
 *   3. Plan/day identity — the started session's `day` is captured in
 *      `activeDay` so the consumer can render "which plan / Day N" above the
 *      tracker (the server-rendered plan name is dropped once the tracker
 *      takes over).
 *
 * A 409 `active_session_conflict` is a NORMAL branch, not an error: the start
 * action returns `{ kind: "conflict", ... }`, which we store in `conflict`.
 *
 * --- Phase 4 web offline (09b-v1) -------------------------------------------
 *
 * Design ADR: "Web offline path relays through existing Server Actions" — the
 * browser queues mutations in IndexedDB and, on flush, invokes the EXISTING
 * `recordWorkoutSetAction` / `completeWorkoutSessionAction`. The browser still
 * NEVER calls the Fastify API directly; it only defers invocation of the
 * existing Server Actions while offline.
 *
 * Write-order invariant: `enqueueMutation` (durable) always happens BEFORE
 * the snapshot write. A crash between the two is self-healing (queue is
 * replayed on next load); the reverse order is not.
 *
 * Flush is strictly SEQUENTIAL (`runSequentialFlush` awaits each ack before
 * the next entry — never `Promise.all`). Failure taxonomy: `UNREACHABLE`/
 * `SERVER` → retry (stays queued); `VALIDATION`/`NOT_FOUND` → poison-drop;
 * `STALE_ACTION` (a Next.js redeploy invalidating the captured Server Action
 * reference) → stays queued + surfaces `syncNotice: "reload_required"`.
 *
 * Offline features degrade gracefully: if `getIdentityKey`/`openStore` throw
 * or resolve `undefined` (e.g. no session, idb unavailable), the hook falls
 * back to the pre-offline direct-call behavior untouched.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { AutoClosedSessionNotice, PendingMutation, WorkoutSessionRecord } from "@kinora/contracts";
import { collapseQueue, isTerminalSessionStatus } from "@kinora/domain/offline";
import {
  abandonSessionAction,
  completeWorkoutSessionAction,
  getWorkoutSessionAction,
  recordWorkoutSetAction,
  startWorkoutSessionAction,
} from "./[id]/actions";
import { WorkoutSessionActionError } from "./[id]/action-errors";
import type { WorkoutSetUpdateInput } from "./[id]/tracker-types";
import type { OfflineStore } from "./offline/store";
import {
  applyOptimisticComplete,
  applyPendingMutation,
  createConnectivityMonitor as createRealConnectivityMonitor,
  discardTerminalSession,
  enqueueMutation,
  ensureIdentityScope,
  getQueuedMutations,
  isStaleActionError,
  openOfflineDb,
  readActiveSessionPointer,
  readSnapshot,
  removeMutation,
  runSequentialFlush,
  writeActiveSessionPointer,
  writeSnapshot,
} from "./offline";
import { getOfflineIdentityKeyAction } from "./[id]/actions";
import type { ConnectivityMonitor } from "@kinora/contracts";

export interface WorkoutSessionConflict {
  activePlanName?: string;
  /** Normalized to `null` (never `undefined`) so the banner branch is total. */
  activeDay: number | null;
  /**
   * 17b scope A: the blocking session's id and start date, so the banner can
   * name its date and offer Resume (navigate to its tracker when
   * `activeDay` is `null`, a legacy row) and Discard.
   */
  activeSessionId: string;
  activeStartedAt: string;
}

export interface UseWorkoutSessionOptions {
  /**
   * Injectable offline dependencies — mirrors `usePlanWs`'s `WebSocketImpl`
   * injection pattern. Defaults to the real idb-backed implementations;
   * tests inject an in-memory store + fake connectivity monitor instead of
   * mocking idb/Server Actions directly (Mock Hygiene Rule).
   */
  offline?: {
    getIdentityKey: () => Promise<string | undefined>;
    openStore: () => Promise<OfflineStore>;
    createConnectivityMonitor: () => ConnectivityMonitor;
  };
}

export interface UseWorkoutSessionResult {
  /** The in-progress session, or `undefined` when the plan/day view is shown. */
  activeSession: WorkoutSessionRecord | undefined;
  /** The day the active session was started for (identity header). */
  activeDay: number | undefined;
  /** Set when a start attempt returns a 409 conflict (structural, not an error). */
  conflict: WorkoutSessionConflict | undefined;
  /**
   * 17b scope A: set when a successful start auto-closed a stale (>24h)
   * session. A non-blocking notice, not an error — the requested session
   * still started.
   */
  autoCloseNotice: AutoClosedSessionNotice | undefined;
  /**
   * 17b scope A: true when the most recent Discard attempt's abandon call
   * failed or the session was no longer discardable (`not_active`). The
   * conflict is NOT cleared and the original start is NOT retried — the one
   * outcome worse than a blocked start is one that silently did nothing.
   */
  discardFailed: boolean;
  /** Non-conflict failure message key (network / not_found / invalid_response). */
  error: string | undefined;
  /**
   * Flush notice for the consumer to surface (Phase 4 web offline):
   *  - `"reload_required"`: a queued mutation's flush hit a stale Server
   *    Action reference (post-redeploy) — the entry stays queued; prompt
   *    the user to reload the page.
   *  - `"auth_required"`: a queued mutation's flush hit a 401/403 (session
   *    expired/revoked, or membership suspended) — the entry stays queued
   *    (retryable, NOT poison-dropped); prompt the user to reload/sign in.
   *  - `"dropped"`: a queued mutation's flush hit a 4xx poison failure
   *    (VALIDATION/NOT_FOUND) and was permanently dropped — surfaced so the
   *    user knows that change was NOT saved (Judgment Day fix #3: dropped
   *    mutations must never disappear silently).
   */
  syncNotice: "reload_required" | "auth_required" | "dropped" | undefined;
  handleStartWorkout: (planId: string, day: number) => Promise<void>;
  handleRecordSet: (setId: string, input: WorkoutSetUpdateInput) => Promise<void>;
  handleCompleteWorkout: (sessionId: string) => Promise<void>;
  /**
   * 17b scope A Discard: abandons the blocking session named by `conflict`,
   * then retries the ORIGINAL requested start (the plan/day the user was
   * trying to start, not the blocking session's day). A no-op when there is
   * no current conflict.
   */
  handleDiscardSession: () => Promise<void>;
  /**
   * 17b scope A Resume: loads the blocking session directly by id and makes
   * it the active session — correct for both a normal conflict and the
   * legacy null-day case, since it never depends on re-deriving the
   * blocking session's plan identity from the client.
   */
  handleResumeSession: (sessionId: string) => Promise<void>;
}

// Wrapped in arrow functions (never a direct reference to the imported
// bindings) so the identifiers are only dereferenced at CALL time, inside
// the mount effect's try/catch. Existing component tests mock "../[id]/actions"
// without `getOfflineIdentityKeyAction` (it predates this slice) — a direct
// top-level reference would throw at module-evaluation time, before any
// try/catch can catch it; deferring the lookup lets the hook degrade
// gracefully to the pre-offline direct-call behavior instead.
const defaultOfflineDeps: NonNullable<UseWorkoutSessionOptions["offline"]> = {
  getIdentityKey: () => getOfflineIdentityKeyAction(),
  openStore: () => openOfflineDb(),
  createConnectivityMonitor: () => createRealConnectivityMonitor(),
};

interface OfflineContext {
  store: OfflineStore;
  identityKey: string;
}

function isRepresentedByAcknowledgement(
  raw: PendingMutation,
  acknowledgement: PendingMutation,
): boolean {
  if (raw.kind !== acknowledgement.kind || raw.sessionId !== acknowledgement.sessionId) {
    return false;
  }

  if (raw.kind === "set" && acknowledgement.kind === "set") {
    return raw.setId === acknowledgement.setId && raw.clientSeq <= acknowledgement.clientSeq;
  }

  return raw.clientSeq <= acknowledgement.clientSeq;
}

export function useWorkoutSession(
  options: UseWorkoutSessionOptions = {},
): UseWorkoutSessionResult {
  const offlineDeps = options.offline ?? defaultOfflineDeps;

  const [activeSession, setActiveSession] = useState<
    WorkoutSessionRecord | undefined
  >();
  const [activeDay, setActiveDay] = useState<number | undefined>();
  const [conflict, setConflict] = useState<WorkoutSessionConflict | undefined>();
  const [autoCloseNotice, setAutoCloseNotice] = useState<AutoClosedSessionNotice | undefined>();
  const [discardFailed, setDiscardFailed] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // 17b scope A: the (planId, day) the user was actually trying to start when
  // a conflict interrupted them — Discard retries THIS, not the blocking
  // session's day. Set on every start attempt so it is always in sync with
  // whichever attempt produced the current conflict.
  const pendingStartRef = useRef<{ planId: string; day: number } | undefined>(undefined);
  const [syncNotice, setSyncNotice] = useState<
    "reload_required" | "auth_required" | "dropped" | undefined
  >();

  const offlineRef = useRef<OfflineContext | undefined>(undefined);
  // Invalidates in-flight offline hydration when a newer start intent has
  // already produced the authoritative active session.
  const sessionIntentRef = useRef(0);
  // Flush reentrancy guard (Judgment Day fix #1): `flush` is invoked from 3
  // independent triggers (connectivity subscriber, end of handleRecordSet,
  // handleCompleteWorkout) with no coordination between them. Without a
  // mutex, overlapping triggers would run `runSequentialFlush` concurrently,
  // breaking the "strictly sequential, one in-flight" invariant. While a
  // flush is in-flight, a second trigger only marks "run again once this
  // pass finishes" — never starts a second concurrent pass — so no queued
  // work introduced during the in-flight pass is missed.
  const isFlushingRef = useRef(false);
  const flushAgainRef = useRef(false);
  // Judgment Day Round-2 fix #1: the SAME `ConnectivityMonitor` instance the
  // "attempt a flush on reconnect" effect below creates, held here so
  // `runFlushPass` can gate a pass on `isOnline()` BEFORE doing anything
  // network-shaped (including the identity recheck, which is itself a
  // Server Action / network round-trip). Offline writes must enqueue +
  // snapshot and return without ever touching the network.
  const connectivityRef = useRef<ConnectivityMonitor | undefined>(undefined);

  const validateOfflineIdentity = useCallback(
    async (ctx: OfflineContext): Promise<boolean> => {
      try {
        const currentIdentityKey = await offlineDeps.getIdentityKey();
        // An unreachable identity lookup cannot prove an account switch. Keep
        // the established mounted context usable so offline writes remain
        // durable; only a resolved different identity blocks the mutation.
        return currentIdentityKey === undefined || currentIdentityKey === ctx.identityKey;
      } catch {
        return true;
      }
    },
    [offlineDeps],
  );

  // Resolve identity + open the store, scope-guard against a previous
  // identity's leftover data, and hydrate any in-progress session from its
  // cached snapshot (design: "read session snapshot → apply queued
  // PendingMutations on top → render", no network GET required).
  useEffect(() => {
    let cancelled = false;
    const hydrationIntent = sessionIntentRef.current;

    (async () => {
      try {
        const identityKey = await offlineDeps.getIdentityKey();
        if (!identityKey || cancelled) return;

        const store = await offlineDeps.openStore();
        await ensureIdentityScope(store, identityKey);
        if (cancelled) return;
        offlineRef.current = { store, identityKey };

        const pointerSessionId = await readActiveSessionPointer(store, identityKey);
        if (!pointerSessionId || cancelled) return;

        const snapshot = await readSnapshot(store, identityKey, pointerSessionId);
        if (!snapshot || cancelled) return;

        // Terminal-pointer recovery. The pointer is PERSISTED local state, so
        // it can outlive the session it names — by any route, including ones
        // we have not thought of. Hydrating a finished session here swaps the
        // tracker in permanently: `/plan` has no navigation escape, so the
        // user is trapped on every visit until they clear IndexedDB.
        //
        // So the pointer is validated, not trusted: a snapshot holding a
        // non-active session is discarded on READ and we fall through to the
        // normal plan view. This is deliberately unconditional on HOW the
        // pointer went stale — it is the recovery mechanism, and a recovery
        // mechanism that needs the cause diagnosed first is not one.
        if (isTerminalSessionStatus(snapshot.session.status)) {
          await discardTerminalSession(store, identityKey, pointerSessionId);
          return;
        }

        const queued = await getQueuedMutations(store, identityKey);
        const collapsed = collapseQueue(queued);
        const hydrated = collapsed.reduce(applyPendingMutation, snapshot.session);

        if (cancelled || hydrationIntent !== sessionIntentRef.current) return;
        setActiveSession(hydrated);
        setActiveDay(hydrated.day);
      } catch {
        // Offline features are best-effort — degrade to the pre-offline
        // direct-call behavior (e.g. no session cookie, idb unavailable, or
        // a test environment that does not mock the offline module).
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One flush PASS: reads the current queue, runs it sequentially, applies
  // the outcome. Extracted from `flush` so the reentrancy guard below can
  // re-run it exactly once more after an in-flight pass settles, without
  // duplicating the body.
  const runFlushPass = useCallback(async () => {
    const ctx = offlineRef.current;
    if (!ctx) return;

    // Judgment Day Round-2 fix #1(a) — gate the ENTIRE pass on connectivity
    // BEFORE doing anything network-shaped. `getIdentityKey` below is a
    // Server Action (a network round-trip): calling it while offline throws
    // ("Failed to fetch"), and since this pass is only ever invoked via
    // `void flush()` from `handleRecordSet`/`handleCompleteWorkout`/the
    // connectivity subscriber, an uncaught throw here becomes an unhandled
    // promise rejection on EVERY offline write. Offline writes must
    // enqueue+snapshot and return without ever touching the network.
    const monitor = connectivityRef.current;
    if (monitor && !monitor.isOnline()) {
      return;
    }

    // Judgment Day Round-2 fix #1(b) — defense-in-depth: even when
    // `isOnline()` reports true, the identity recheck itself can still
    // throw/reject (transient network blip, server error). Treat that
    // exactly like an offline gate: abort this pass silently, queue stays
    // intact, no unhandled rejection. This also fixes the related
    // Judge-B point: a THROWN/rejected recheck (or an `undefined`
    // resolution) means identity could not be CONFIRMED — treat it as
    // retryable (`UNREACHABLE`), never as a confirmed account switch. Only
    // a resolved, DEFINED, DIFFERENT key is a confirmed switch (fix #6,
    // unchanged below).
    let currentIdentityKey: string | undefined;
    try {
      currentIdentityKey = await offlineDeps.getIdentityKey();
    } catch {
      return;
    }
    if (currentIdentityKey === undefined) {
      return;
    }

    // Judgment Day fix #6 — re-verify identity before flush: confirm the
    // store's bound identity still matches the CURRENT authenticated
    // identity before dispatching. On a long-lived mounted instance an
    // account switch could otherwise flush the previous identity's queue
    // under the new ambient session. Defense-in-depth on top of fix #5's
    // per-identity namespacing (which already prevents cross-account
    // reads) — abort this pass rather than flush under a mismatched
    // identity; the queue stays intact for its own identity's next flush.
    if (currentIdentityKey !== ctx.identityKey) {
      return;
    }

    const queued = await getQueuedMutations(ctx.store, ctx.identityKey);
    if (queued.length === 0) {
      // Judgment Day Round-2 fix #3 — a clean empty-queue pass means every
      // previously-queued mutation is now accounted for. Transient notices
      // (`auth_required` / `reload_required`) exist to prompt the user to
      // act SO THE QUEUE CAN DRAIN — once it has drained, the prompt is
      // stale and must self-clear. `dropped` stays sticky: it communicates
      // a PERMANENT data loss that already happened, which remains true
      // regardless of the queue's current state.
      setSyncNotice((prev) => (prev === "dropped" ? prev : undefined));
      return;
    }

    const collapsed = collapseQueue(queued);

    const summary = await runSequentialFlush(collapsed, async (mutation) => {
      try {
        const session =
          mutation.kind === "complete"
            ? await completeWorkoutSessionAction(mutation.sessionId)
            : await recordWorkoutSetAction(mutation.sessionId, mutation.setId, mutation.input);
        return { kind: "ok", session };
      } catch (err) {
        if (isStaleActionError(err)) {
          return { kind: "stale" };
        }
        const code =
          err instanceof WorkoutSessionActionError ? err.code : "SERVER";
        return { kind: "error", code };
      }
    });

    const acknowledged = [...summary.synced, ...summary.dropped];
    const acknowledgedRaw = queued.filter((raw) =>
      acknowledged.some((mutation) => isRepresentedByAcknowledgement(raw, mutation)),
    );

    for (const mutation of acknowledgedRaw) {
      await removeMutation(ctx.store, ctx.identityKey, mutation.clientSeq);
    }

    if (summary.lastAckedSession) {
      const acked = summary.lastAckedSession;
      await writeSnapshot(ctx.store, ctx.identityKey, acked.id, acked);
      setActiveSession((prev) => (prev?.id === acked.id ? acked : prev));

      // Scoped to the acknowledged session (mobile's shape): a mutation still
      // queued for a DIFFERENT session says nothing about whether this one is
      // finished, and gating on a globally empty queue left the finished
      // session's pointer behind whenever anything else was pending.
      const hasRemainingForSession = summary.remaining.some(
        (mutation) => mutation.sessionId === acked.id,
      );
      if (isTerminalSessionStatus(acked.status) && !hasRemainingForSession) {
        await discardTerminalSession(ctx.store, ctx.identityKey, acked.id);
      }
    }

    // Judgment Day fix #3/#4: a poison-drop (VALIDATION/NOT_FOUND) MUST
    // surface to the user, never just silently empty the queue. Priority:
    // reload (stale action) > auth (session expired mid-flush, still
    // queued) > dropped (permanently lost, poison message).
    if (summary.staleActionDetected) {
      setSyncNotice("reload_required");
    } else if (summary.haltCode === "AUTH") {
      setSyncNotice("auth_required");
    } else if (summary.dropped.length > 0) {
      setSyncNotice("dropped");
    } else {
      setSyncNotice(undefined);
    }
  }, []);

  const flush = useCallback(async () => {
    if (isFlushingRef.current) {
      // A flush is already in-flight — do not start a second concurrent
      // pass. Mark "run again once the current one finishes" so any work
      // that motivated this trigger is never missed.
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
          // Every caller invokes flush() fire-and-forget (void flush())
          // from a synchronous event handler — a rejection here would
          // surface as an unhandled promise rejection on the mainline
          // offline write path (IndexedDB quota, Safari ITP eviction, DB
          // corruption). Before removal completes, unacknowledged or
          // not-successfully-removed mutations remain queued and may retry
          // on a later valid trigger; a partial delete may leave the
          // queue partially depleted. After removal completes, snapshot/
          // cleanup failures are swallowed and acknowledged mutations are
          // not retryable, so the snapshot/pointer may be left stale
          // (09d-v1-offline-flush-hardening; mirrors mobile's flush() inner
          // try/catch). A stale pointer is no longer terminal for the user:
          // mount hydration discards a pointer whose snapshot holds a
          // non-active session (#398).
        }
      } while (flushAgainRef.current);
    } finally {
      isFlushingRef.current = false;
    }
  }, [runFlushPass]);

  // Attempt a flush whenever connectivity comes back online.
  useEffect(() => {
    const monitor = offlineDeps.createConnectivityMonitor();
    connectivityRef.current = monitor;
    const unsubscribe = monitor.subscribe((online) => {
      if (online) void flush();
    });
    return () => {
      connectivityRef.current = undefined;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flush]);

  const handleStartWorkout = useCallback(async (planId: string, day: number) => {
    const ctx = offlineRef.current;
    if (ctx && !(await validateOfflineIdentity(ctx))) {
      setSyncNotice("auth_required");
      return;
    }

    // 17b scope A: remember what the user actually asked for, so Discard can
    // retry THIS exact attempt after abandoning the blocking session.
    pendingStartRef.current = { planId, day };
    // A repeated start attempt clears the PRIOR auto-close notice up front —
    // otherwise a stale notice from an earlier attempt would linger next to
    // an unrelated new conflict/session.
    setAutoCloseNotice(undefined);

    try {
      const result = await startWorkoutSessionAction(planId, day);
      // A 409 conflict is a structural branch — set state, never throw/crash.
      if (result.kind === "conflict") {
        setConflict({
          activePlanName: result.activePlanName,
          activeDay: result.activeDay ?? null,
          activeSessionId: result.activeSessionId ?? "",
          activeStartedAt: result.activeStartedAt ?? "",
        });
        return;
      }
      // Successful start clears any prior conflict/error so a retry on another
      // day starts clean.
      sessionIntentRef.current += 1;
      setConflict(undefined);
      setDiscardFailed(false);
      setError(undefined);
      setActiveDay(result.session.day ?? day);
      setActiveSession(result.session);
      setAutoCloseNotice(result.autoClosedSession);

      if (ctx) {
        await writeSnapshot(ctx.store, ctx.identityKey, result.session.id, result.session);
        await writeActiveSessionPointer(ctx.store, ctx.identityKey, result.session.id);
      }
    } catch {
      // Non-conflict failures throw (network / not_found / invalid_response).
      // Surface them inline instead of crashing the render.
      setError("tracker_error_start");
    }
  }, [validateOfflineIdentity]);

  const handleDiscardSession = useCallback(async () => {
    const blockingSessionId = conflict?.activeSessionId;
    const pending = pendingStartRef.current;
    if (!blockingSessionId || !pending) return;

    try {
      const outcome = await abandonSessionAction(blockingSessionId);
      if (outcome.kind !== "ok") {
        // `not_active` — the session is no longer discardable (already
        // completed elsewhere). Never silently retry the start: the user
        // must see that Discard did not do what they asked.
        setDiscardFailed(true);
        return;
      }

      // Abandon is a terminal transition too, so the blocking session's
      // pointer/snapshot must go with it — otherwise the session the user
      // just discarded stays the one hydration restores on the next mount.
      const ctx = offlineRef.current;
      if (ctx) {
        try {
          await discardTerminalSession(ctx.store, ctx.identityKey, blockingSessionId);
        } catch {
          // Best-effort cleanup — the abandon itself already succeeded.
        }
      }

      setDiscardFailed(false);
      setConflict(undefined);
      await handleStartWorkout(pending.planId, pending.day);
    } catch {
      // The mutation itself may or may not have landed — treating it as
      // failed and NOT retrying the start is the safer default: the one
      // outcome worse than a blocked start is one that silently did nothing.
      setDiscardFailed(true);
    }
  }, [conflict, handleStartWorkout]);

  const handleResumeSession = useCallback(async (sessionId: string) => {
    try {
      const session = await getWorkoutSessionAction(sessionId);
      sessionIntentRef.current += 1;
      setConflict(undefined);
      setDiscardFailed(false);
      setError(undefined);
      setActiveDay(session.day);
      setActiveSession(session);

      const ctx = offlineRef.current;
      if (ctx) {
        // A terminal session must never BECOME the persisted pointer. The
        // server can legitimately answer with a session that finished
        // elsewhere; showing it once is fine, persisting it as "the session
        // to restore on every future mount" is the trap.
        if (isTerminalSessionStatus(session.status)) {
          await discardTerminalSession(ctx.store, ctx.identityKey, session.id);
        } else {
          await writeSnapshot(ctx.store, ctx.identityKey, session.id, session);
          await writeActiveSessionPointer(ctx.store, ctx.identityKey, session.id);
        }
      }
    } catch {
      setError("tracker_error_start");
    }
  }, []);

  const handleRecordSet = useCallback(
    async (setId: string, input: WorkoutSetUpdateInput) => {
      if (!activeSession) return;
      const sessionId = activeSession.id;
      const ctx = offlineRef.current;

      if (ctx) {
        if (!(await validateOfflineIdentity(ctx))) {
          setSyncNotice("auth_required");
          return;
        }

        let enqueueSucceeded = false;
        // Offline-safe path: durably ENQUEUE first (write-order invariant —
        // a crash before the snapshot write is self-healing via replay), then
        // optimistically apply the mutation to local UI + the cached
        // snapshot, then attempt an immediate flush if online.
        try {
          const mutation = await enqueueMutation(ctx.store, ctx.identityKey, {
            kind: "set",
            sessionId,
            setId,
            input,
            queuedAt: Date.now(),
          });
          enqueueSucceeded = true;

          setActiveSession((prev) => {
            if (!prev || prev.id !== sessionId) return prev;
            return applyPendingMutation(prev, mutation);
          });

          const snapshot = await readSnapshot(ctx.store, ctx.identityKey, sessionId);
          const base = snapshot?.session ?? activeSession;
          if (base) {
            const updated = applyPendingMutation(base, mutation);
            await writeSnapshot(ctx.store, ctx.identityKey, sessionId, updated);
          }

          setError(undefined);
          void flush();
          return;
        } catch {
          if (enqueueSucceeded) {
            // The mutation is durable; do not replay it through the direct
            // action if snapshot persistence fails after enqueue.
            setSyncNotice("reload_required");
            return;
          }
          // Offline module unavailable before enqueue — use the direct path.
        }
      }

      try {
        const session = await recordWorkoutSetAction(sessionId, setId, input);
        setError(undefined);
        setActiveSession(session);
      } catch {
        setError("tracker_error_record");
      }
    },
    [activeSession, flush, validateOfflineIdentity],
  );

  const handleCompleteWorkout = useCallback(async (sessionId: string) => {
    const ctx = offlineRef.current;

    if (ctx) {
      if (!(await validateOfflineIdentity(ctx))) {
        setSyncNotice("auth_required");
        return;
      }

      let enqueueSucceeded = false;
      try {
        // Enqueue-first (durable), then optimistically flip the cached
        // snapshot's session.status to "completed" — design: "Complete-
        // mutation optimistic semantics" — so an offline reload before ack
        // still renders as completed.
        await enqueueMutation(ctx.store, ctx.identityKey, {
          kind: "complete",
          sessionId,
          queuedAt: Date.now(),
        });
        enqueueSucceeded = true;

        const snapshot = await readSnapshot(ctx.store, ctx.identityKey, sessionId);
        if (snapshot) {
          await writeSnapshot(
            ctx.store,
            ctx.identityKey,
            sessionId,
            applyOptimisticComplete(snapshot).session,
          );
        }

        setError(undefined);
        setActiveDay(undefined);
        setActiveSession(undefined);
        void flush();
        return;
      } catch {
        if (enqueueSucceeded) {
          setSyncNotice("reload_required");
          return;
        }
        // Offline module unavailable before enqueue — use the direct path.
      }
    }

    try {
      // The completed session is persisted server-side; we do not keep it in
      // state, otherwise the tracker would render forever with no way back to
      // the plan view (there is no navigation escape on /plan).
      await completeWorkoutSessionAction(sessionId);
      setError(undefined);
      setActiveDay(undefined);
      setActiveSession(undefined);
    } catch {
      setError("tracker_error_complete");
      return;
    }

    // The session is terminal now, so its pointer must go — reaching a
    // terminal state is what clears the pointer, not passing through one
    // particular branch of the flush. This path runs when the offline module
    // was unavailable before the durable enqueue, which is precisely when no
    // flush will ever acknowledge this completion.
    if (ctx) {
      try {
        await discardTerminalSession(ctx.store, ctx.identityKey, sessionId);
      } catch {
        // Best-effort cleanup: the completion itself already succeeded, and
        // hydration discards a terminal pointer on read anyway.
      }
    }
  }, [flush, validateOfflineIdentity]);

  return {
    activeSession,
    activeDay,
    conflict,
    autoCloseNotice,
    discardFailed,
    error,
    syncNotice,
    handleStartWorkout,
    handleRecordSet,
    handleCompleteWorkout,
    handleDiscardSession,
    handleResumeSession,
  };
}
