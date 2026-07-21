import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { computeAverageRpe, computeSessionVolume, computeVolumeTrend, defaultPlanName } from "@kinora/domain";
import { classifyExerciseMuscleGroup } from "../muscle-classifier.js";
import {
  addUtcDays as domainAddUtcDays,
  computeAdherence,
  computeMuscleGroupDistribution,
  computePersonalRecords,
  computeStreak,
  computeWeeklyPlanVsCompletion,
  computeWeeklyRollup,
  delta,
  normalizeTitle,
  utcWeekBounds as domainUtcWeekBounds,
  type MuscleGroupDistributionExercise,
  type PersonalRecordSetInput,
} from "../progress-domain.js";
import type {
  DashboardSummaryDTO,
  DeleteSessionOutcome,
  ExerciseDetailDTO,
  KpiWithDelta,
  MuscleGroup,
  SessionExerciseRecord,
  SetRecordDTO,
  StartSessionOutcome,
  StatsSummaryDTO,
  WeeklyOverviewDTO,
  WorkoutExercise,
  WorkoutHistoryEntry,
  WorkoutHistoryQuery,
  WorkoutProgram,
  WorkoutSessionRecord,
} from "@kinora/contracts";
import type { Database } from "../client.js";
import { sessionExercises, setRecords, workoutPlans, workoutSessions } from "../schema.js";

interface WorkoutPlanRow {
  id: string;
  tenantId: string;
  userId: string;
  status: "generating" | "ready" | "failed";
  programJson: WorkoutProgram | null;
}

interface WorkoutSessionRow {
  id: string;
  tenantId: string;
  userId: string;
  workoutPlanId: string;
  status: "active" | "completed";
  day: number | null;
  startedAt: Date;
  completedAt: Date | null;
}

interface SessionExerciseRow {
  id: string;
  workoutSessionId: string;
  exerciseIndex: number;
  title: string;
  restSeconds: number;
  notes: string | null;
  /**
   * Derived muscle-group classification (09c-v1 Slice 1b). Populated at
   * write time via `classifyExerciseMuscleGroup`; `null` when the title is
   * unmapped. Read directly by `getStatsRange` (Slice 3b) for the
   * muscle-group distribution — not surfaced on `SessionExerciseRecord`.
   */
  muscleGroup: string | null | undefined;
}

interface SetRecordRow {
  id: string;
  sessionExerciseId: string;
  setIndex: number;
  targetReps: string;
  actualReps: number | null;
  weightKg: number | string | null;
  rpe: number | null;
  completed: boolean;
  notes: string | null;
}

type StartTx = Pick<Database, "insert">;

const DEFAULT_HISTORY_LIMIT = 20;

/**
 * Bounded lookback window for `getDashboardSummary` (09c-v1
 * progress-dashboard-stats, Slice 2). Wide enough to cover any realistic
 * streak/weekly-progress calculation while staying a single bounded query,
 * mirroring `listCompletedSessions`'s bounded-page approach.
 */
const DASHBOARD_HISTORY_LIMIT = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Bounded lookback window for `getExerciseDetail` (Slice 4b) — how many of
 * the caller's most-recent completed sessions are scanned for a title match,
 * and how many recent sets are surfaced. Mirrors `DASHBOARD_HISTORY_LIMIT`'s
 * bounded-page approach.
 */
const EXERCISE_DETAIL_SESSION_SCAN_LIMIT = 60;
const EXERCISE_DETAIL_RECENT_SETS_LIMIT = 10;

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Monday 00:00:00.000 UTC .. Sunday 23:59:59.999 UTC bounds of `reference`'s week. */
function utcWeekBounds(reference: Date): { start: Date; end: Date } {
  const day = startOfUtcDay(reference);
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  const start = addUtcDays(day, -mondayOffset);
  const end = new Date(addUtcDays(start, 7).getTime() - 1);
  return { start, end };
}

/** First-of-month 00:00:00.000 UTC .. last-of-month 23:59:59.999 UTC bounds of `reference`'s month. */
function utcMonthBounds(reference: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1) - 1);
  return { start, end };
}

/** Jan 1 00:00:00.000 UTC .. Dec 31 23:59:59.999 UTC bounds of `reference`'s year. */
function utcYearBounds(reference: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(reference.getUTCFullYear(), 0, 1));
  const end = new Date(Date.UTC(reference.getUTCFullYear() + 1, 0, 1) - 1);
  return { start, end };
}

interface StatsRangeBounds {
  currentStart: Date;
  currentEnd: Date;
  previousStart: Date;
  previousEnd: Date;
}

/**
 * Resolves the current/previous UTC period bounds for `getStatsRange`
 * (09c-v1-progress-dashboard-stats, Slice 3a). `previousStart..currentEnd`
 * is one contiguous span, so the repository can fetch both periods with a
 * single bounded date-range query (design.md "Timezone: fixed UTC reference").
 */
function statsRangeBounds(range: "week" | "month" | "year", now: Date): StatsRangeBounds {
  if (range === "week") {
    const current = utcWeekBounds(now);
    const previous = utcWeekBounds(addUtcDays(current.start, -1));
    return {
      currentStart: current.start,
      currentEnd: current.end,
      previousStart: previous.start,
      previousEnd: previous.end,
    };
  }

  if (range === "year") {
    const current = utcYearBounds(now);
    const previous = utcYearBounds(new Date(current.start.getTime() - 1));
    return {
      currentStart: current.start,
      currentEnd: current.end,
      previousStart: previous.start,
      previousEnd: previous.end,
    };
  }

  const current = utcMonthBounds(now);
  const previous = utcMonthBounds(new Date(current.start.getTime() - 1));
  return {
    currentStart: current.start,
    currentEnd: current.end,
    previousStart: previous.start,
    previousEnd: previous.end,
  };
}

function zeroKpi(): KpiWithDelta {
  return { value: 0, deltaVsPreviousPeriod: null };
}

function emptyStatsSummary(range: "week" | "month" | "year"): StatsSummaryDTO {
  return {
    range,
    totalVolumeKg: zeroKpi(),
    sessionCount: zeroKpi(),
    totalDurationMin: zeroKpi(),
    prCount: zeroKpi(),
    volumeTrend: { current: [], previous: [] },
    muscleGroupDistribution: [],
    personalRecords: [],
  };
}

/**
 * Locale-neutral "8–14 Jul" style week label for `WeeklyOverviewDTO`
 * (Slice 4b). Deliberately neutral (not localized) — the API layer has no
 * user-locale context; the web layer may re-derive a localized label from
 * `weekStart`/`weekLabel` if a future change wants full i18n parity here.
 */
function formatWeekLabel(start: Date, end: Date): string {
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(start);
  return `${start.getUTCDate()}–${end.getUTCDate()} ${month}`;
}

function recentDailyCompletion(completedAtDates: string[], now: Date, days = 7): boolean[] {
  const dayKeys = new Set(completedAtDates.map((iso) => iso.slice(0, 10)));
  const result: boolean[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addUtcDays(startOfUtcDay(now), -offset);
    result.push(dayKeys.has(day.toISOString().slice(0, 10)));
  }
  return result;
}

export interface UpdateSetRecordInput {
  actualReps?: number;
  weightKg?: number;
  rpe?: number;
  completed: boolean;
  notes?: string;
}

export class WorkoutSessionRepository {
  constructor(private db: Database) {}

  /**
   * Starts (or resumes) a day-scoped workout session (#93).
   *
   * The `singleActivePerUser` partial unique index guarantees ≤1 active row per
   * (tenant, user), so we fetch the one active row and compare in code:
   *   - Branch A: active row matches (planId, day)      → resume (findById)
   *   - Branch B: active row is a different (planId, day) → conflict
   *       (a legacy null-day row can never match, so it always conflicts)
   *   - Branch C: no active row                          → create, persisting `day`
   *
   * Returns `undefined` only when the plan is not ready or the requested day is
   * not part of the program (the route maps this to 404, unchanged).
   */
  async startSession(
    tenantId: string,
    userId: string,
    workoutPlanId: string,
    day: number
  ): Promise<StartSessionOutcome | undefined> {
    const existingActive = await this.findLatestActiveSession(tenantId, userId);
    if (existingActive) {
      // Branch A — same plan and same day → resume the in-progress session.
      if (existingActive.workoutPlanId === workoutPlanId && existingActive.day === day) {
        const session = await this.findById(tenantId, userId, existingActive.id);
        if (!session) {
          return undefined;
        }
        return { kind: "resumed", session };
      }

      // Branch B — a different (planId, day), or a legacy null-day row.
      // Resolve the active plan's display label so the client can render a
      // meaningful banner. The lookup is scoped to (tenantId, userId) — NEVER
      // an unscoped `WHERE id =` — so it can only surface the caller's own plan.
      const activePlanName = await this.findActivePlanName(
        tenantId,
        userId,
        existingActive.workoutPlanId
      );

      return {
        kind: "conflict",
        activePlanId: existingActive.workoutPlanId,
        activePlanName,
        activeDay: existingActive.day,
      };
    }

    const plan = await this.findReadyPlan(tenantId, userId, workoutPlanId);
    if (!plan?.programJson) {
      return undefined;
    }

    const plannedSession = plan.programJson.weeklySessions.find((session) => session.day === day);
    if (!plannedSession) {
      return undefined;
    }

    // Branch C — no active session → create a new row, persisting the day.
    return this.db.transaction(async (tx) => {
      const sessionRows = await tx
        .insert(workoutSessions)
        .values({ tenantId, userId, workoutPlanId, status: "active", day })
        .returning();
      const sessionRow = sessionRows[0] as WorkoutSessionRow | undefined;
      if (!sessionRow) {
        return undefined;
      }

      const exerciseRows = await this.insertSessionExercises(tx, sessionRow.id, plannedSession.exercises);
      const setRows = await this.insertSetRecords(tx, exerciseRows, plannedSession.exercises);

      return { kind: "started", session: mapWorkoutSessionRecord(sessionRow, exerciseRows, setRows) };
    });
  }

  async findById(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<WorkoutSessionRecord | undefined> {
    const sessionRows = await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.id, id)
        )
      );
    const sessionRow = sessionRows[0] as WorkoutSessionRow | undefined;
    if (!sessionRow) {
      return undefined;
    }

    const exerciseRows = (await this.db
      .select()
      .from(sessionExercises)
      .where(eq(sessionExercises.workoutSessionId, sessionRow.id))
      .orderBy(sessionExercises.exerciseIndex)) as SessionExerciseRow[];

    const exerciseIds = exerciseRows.map((exercise) => exercise.id);
    const setRows =
      exerciseIds.length === 0
        ? []
        : ((await this.db
            .select()
            .from(setRecords)
            .where(inArray(setRecords.sessionExerciseId, exerciseIds))) as SetRecordRow[]);

    return mapWorkoutSessionRecord(sessionRow, exerciseRows, setRows);
  }

  async recordSet(
    tenantId: string,
    userId: string,
    sessionId: string,
    setId: string,
    input: UpdateSetRecordInput
  ): Promise<WorkoutSessionRecord | undefined> {
    const session = await this.findById(tenantId, userId, sessionId);
    if (!session || session.status !== "active") {
      return undefined;
    }

    const ownsSet = session.exercises.some((exercise) =>
      exercise.setRecords.some((setRecord) => setRecord.id === setId)
    );
    if (!ownsSet) {
      return undefined;
    }

    // risk-BLOCKER (IDOR): the ownership pre-check above is necessary but NOT
    // sufficient — the write itself must be constrained to a set that belongs
    // to THIS session. Scoping only by `setId` would let a caller who owns
    // session S1 mutate a set from another user's session S2 (cross-tenant
    // write). We therefore require the set's `sessionExerciseId` to belong to
    // an exercise of `sessionId`, enforced in SQL via a correlated subquery, so
    // the UPDATE can physically affect only the caller's own session rows.
    const setBelongsToSession = inArray(
      setRecords.sessionExerciseId,
      this.db
        .select({ id: sessionExercises.id })
        .from(sessionExercises)
        .where(eq(sessionExercises.workoutSessionId, sessionId))
    );

    const rows = await this.db
      .update(setRecords)
      .set({
        actualReps: input.actualReps ?? null,
        weightKg: input.weightKg === undefined ? null : input.weightKg.toString(),
        rpe: input.rpe ?? null,
        completed: input.completed,
        notes: input.notes ?? null,
      })
      .where(and(eq(setRecords.id, setId), setBelongsToSession))
      .returning();
    if (rows.length === 0) {
      return undefined;
    }

    return this.findById(tenantId, userId, sessionId);
  }

  /**
   * Completes an active session (idempotent — #09b).
   *
   * The `WHERE status='active'` guard means a retried complete call (e.g.
   * after a dropped response) affects 0 rows on the second attempt. Rather
   * than mapping that straight to 404, we recover by re-reading the session
   * scoped **exactly like `findById`** — `(tenantId, userId, id)` — NEVER an
   * unscoped `WHERE id = :id` (that would be the same IDOR class already
   * fixed in `recordSet`, see its documented BLOCKER comment above). If the
   * scoped re-read finds the row and it is already `completed`, we return it
   * as a 200 no-op without re-running completion side effects. If the scoped
   * re-read finds nothing (wrong tenant/user, or truly nonexistent id), we
   * return undefined so the route maps it to 404 — unchanged contract.
   */
  async completeSession(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<WorkoutSessionRecord | undefined> {
    const rows = await this.db
      .update(workoutSessions)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.id, id),
          eq(workoutSessions.status, "active")
        )
      )
      .returning();
    if (rows.length > 0) {
      return this.findById(tenantId, userId, id);
    }

    const existing = await this.findById(tenantId, userId, id);
    if (existing?.status === "completed") {
      return existing;
    }

    return undefined;
  }

  /**
   * Deletes a single workout session owned by the caller (10c-workout-session-delete).
   *
   * Two-phase, scoped write — same IDOR discipline as `recordSet` /
   * `completeSession`:
   *
   * 1. `DELETE ... WHERE (tenantId, userId, id) AND status='completed'`. The
   *    `status='completed'` guard is R3's active-session protection at the
   *    storage layer: an in-progress session is physically excluded from the
   *    delete so it can never be silently removed. Cascading FKs
   *    (`onDelete: "cascade"` on `session_exercises` → `workout_sessions` and
   *    `set_records` → `session_exercises`) atomically drop the child rows.
   * 2. On a 0-row delete, disambiguate with a SCOPED re-read — NEVER an
   *    unscoped `WHERE id = :id` (that would let a caller learn another
   *    tenant's/user's session exists). The re-read resolves one of:
   *      - row with `status='active'` → `active_conflict` (route: 409)
   *      - no row → `not_found` (route: 404), covering nonexistent, another
   *        user's session, and another tenant's session indistinguishably.
   */
  async deleteById(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<DeleteSessionOutcome> {
    const deleted = await this.db
      .delete(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.id, id),
          eq(workoutSessions.status, "completed")
        )
      )
      .returning({ id: workoutSessions.id });

    if (deleted.length > 0) {
      return { kind: "deleted" };
    }

    const rows = await this.db
      .select({ status: workoutSessions.status })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.id, id)
        )
      );
    const row = rows[0] as { status: string } | undefined;
    if (row && row.status === "active") {
      return { kind: "active_conflict" };
    }
    return { kind: "not_found" };
  }

  /**
   * Paginated, read-only history of completed sessions (#09b Session
   * History — sync-independent, never touches the offline queue/snapshot).
   *
   * Batch-fetches with a **constant, bounded number of queries regardless of
   * page size**: (1) one page query over `workout_sessions` scoped by
   * `(tenantId, userId)`, ordered newest-first, fetching `limit + 1` rows —
   * the `+1` row is a bounded lookback used only to derive the oldest page
   * item's trend, never returned as a page entry itself; (2) one
   * `inArray(sessionIds)` query across every fetched session (including the
   * lookback row) for `session_exercises`; (3) one `inArray(sessionExerciseId)`
   * query for `set_records` (which has no `sessionId` column, so it can only
   * be reached via the exercise ids from step 2). Results are grouped in
   * memory to reassemble each `WorkoutHistoryEntry`.
   *
   * Anti-pattern (explicitly rejected by design): looping the page and
   * calling `findById` once per session — that is correct for a single-session
   * read but an N+1 bug at list scale, and MUST NOT be reintroduced here.
   *
   * Trend: each entry's `trend` compares it against the row immediately
   * after it in the SAME fetched result set (which is already ordered
   * newest-first) — so entry `i` pairs with fetched row `i + 1`. For the
   * last page item, that pairing is exactly the `+1` lookback row. A
   * mismatched `workoutPlanId` between the pair yields `trend: undefined`
   * (no cross-plan comparison), matching `computeVolumeTrend`'s "no prior
   * session in scope" contract.
   */
  async listCompletedSessions(
    tenantId: string,
    userId: string,
    query: WorkoutHistoryQuery
  ): Promise<WorkoutHistoryEntry[]> {
    const limit = query.limit ?? DEFAULT_HISTORY_LIMIT;
    const offset = query.offset ?? 0;

    const sessionRows = (await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed")
        )
      )
      .orderBy(desc(workoutSessions.completedAt))
      .limit(limit + 1)
      .offset(offset)) as WorkoutSessionRow[];

    if (sessionRows.length === 0) {
      return [];
    }

    const sessionIds = sessionRows.map((row) => row.id);
    const exerciseRows = (await this.db
      .select()
      .from(sessionExercises)
      .where(inArray(sessionExercises.workoutSessionId, sessionIds))) as SessionExerciseRow[];

    const exerciseIds = exerciseRows.map((exercise) => exercise.id);
    const setRows =
      exerciseIds.length === 0
        ? []
        : ((await this.db
            .select()
            .from(setRecords)
            .where(inArray(setRecords.sessionExerciseId, exerciseIds))) as SetRecordRow[]);

    const exercisesBySession = new Map<string, SessionExerciseRow[]>();
    for (const exerciseRow of exerciseRows) {
      const current = exercisesBySession.get(exerciseRow.workoutSessionId) ?? [];
      current.push(exerciseRow);
      exercisesBySession.set(exerciseRow.workoutSessionId, current);
    }

    const setsByExercise = new Map<string, SetRecordRow[]>();
    for (const setRow of setRows) {
      const current = setsByExercise.get(setRow.sessionExerciseId) ?? [];
      current.push(setRow);
      setsByExercise.set(setRow.sessionExerciseId, current);
    }

    const records = sessionRows.map((sessionRow) => {
      const ownExercises = exercisesBySession.get(sessionRow.id) ?? [];
      const ownSets = ownExercises.flatMap((exercise) => setsByExercise.get(exercise.id) ?? []);
      return mapWorkoutSessionRecord(sessionRow, ownExercises, ownSets);
    });

    return records.slice(0, limit).map((session, index) => {
      const priorSession = records[index + 1];
      const trend =
        priorSession && priorSession.workoutPlanId === session.workoutPlanId
          ? computeVolumeTrend(session, priorSession)
          : undefined;

      return {
        session,
        totalVolume: computeSessionVolume(session),
        averageRpe: computeAverageRpe(session),
        trend,
      };
    });
  }

  /**
   * Dashboard summary (09c-v1-progress-dashboard-stats, Slice 2) — streak,
   * weekly progress (X/Y), and the "Ruta de carga" per-day rollup.
   *
   * Bounded, no N+1, mirroring `listCompletedSessions`: (1) one bounded page
   * of the caller's completed sessions (`DASHBOARD_HISTORY_LIMIT`, scoped by
   * (tenantId, userId)); (2) one lookup of the latest ready plan (for the
   * planned weekly count and the week-route focus labels). Only when at
   * least one of those sessions falls inside the CURRENT UTC calendar week
   * do we issue two further bounded `inArray` queries (session_exercises,
   * set_records) to compute that week's per-day volume — an empty week
   * short-circuits before any per-session data is fetched, so an inactive
   * user costs exactly 2 queries, never 4.
   */
  async getDashboardSummary(
    tenantId: string,
    userId: string,
    now: Date = new Date()
  ): Promise<DashboardSummaryDTO> {
    const completedRows = (await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed")
        )
      )
      .orderBy(desc(workoutSessions.completedAt))
      .limit(DASHBOARD_HISTORY_LIMIT)) as WorkoutSessionRow[];

    const planRows = (await this.db
      .select()
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.status, "ready")
        )
      )
      .orderBy(desc(workoutPlans.createdAt))
      .limit(1)) as WorkoutPlanRow[];

    const latestReadyPlan = planRows[0];
    const completedAtDates = completedRows
      .map((row) => row.completedAt?.toISOString())
      .filter((iso): iso is string => iso !== undefined);

    const plannedSessionsPerWeek = latestReadyPlan?.programJson?.weeklySessions.length ?? 0;
    const { weeklyCompleted, weeklyPlanned } = computeAdherence(
      { completedAtDates, plannedSessionsPerWeek },
      now
    );

    const { start: weekStart, end: weekEnd } = utcWeekBounds(now);
    const weeklyCompletedRows = completedRows.filter(
      (row) => row.completedAt && row.completedAt >= weekStart && row.completedAt <= weekEnd
    );

    const weeklySessions =
      weeklyCompletedRows.length === 0
        ? []
        : await this.buildWeeklyRollupSessions(weeklyCompletedRows);

    const planDays =
      latestReadyPlan?.programJson?.weeklySessions.map((session) => ({
        dayIndex: session.day - 1,
        focus: session.title,
      })) ?? [];

    return {
      streak: computeStreak(completedAtDates, now),
      recentDailyCompletion: recentDailyCompletion(completedAtDates, now),
      weeklyCompleted,
      weeklyPlanned,
      weeklyRollup: computeWeeklyRollup({ planDays, sessions: weeklySessions }, now),
    };
  }

  /**
   * Computes `{ completedAt, volumeKg }` for a small set of already-fetched,
   * current-week completed session rows — two bounded `inArray` queries
   * (never per-session), reusing `computeSessionVolume`.
   */
  private async buildWeeklyRollupSessions(
    weeklyCompletedRows: WorkoutSessionRow[]
  ): Promise<Array<{ completedAt: string; volumeKg: number }>> {
    const sessionIds = weeklyCompletedRows.map((row) => row.id);
    const exerciseRows = (await this.db
      .select()
      .from(sessionExercises)
      .where(inArray(sessionExercises.workoutSessionId, sessionIds))) as SessionExerciseRow[];

    const exerciseIds = exerciseRows.map((exercise) => exercise.id);
    const setRows =
      exerciseIds.length === 0
        ? []
        : ((await this.db
            .select()
            .from(setRecords)
            .where(inArray(setRecords.sessionExerciseId, exerciseIds))) as SetRecordRow[]);

    const exercisesBySession = new Map<string, SessionExerciseRow[]>();
    for (const exerciseRow of exerciseRows) {
      const current = exercisesBySession.get(exerciseRow.workoutSessionId) ?? [];
      current.push(exerciseRow);
      exercisesBySession.set(exerciseRow.workoutSessionId, current);
    }

    const setsByExercise = new Map<string, SetRecordRow[]>();
    for (const setRow of setRows) {
      const current = setsByExercise.get(setRow.sessionExerciseId) ?? [];
      current.push(setRow);
      setsByExercise.set(setRow.sessionExerciseId, current);
    }

    return weeklyCompletedRows.map((sessionRow) => {
      const ownExercises = exercisesBySession.get(sessionRow.id) ?? [];
      const ownSets = ownExercises.flatMap((exercise) => setsByExercise.get(exercise.id) ?? []);
      const session = mapWorkoutSessionRecord(sessionRow, ownExercises, ownSets);
      return {
        completedAt: sessionRow.completedAt!.toISOString(),
        volumeKg: computeSessionVolume(session),
      };
    });
  }

  /**
   * Statistics summary (09c-v1-progress-dashboard-stats, Slices 3a+3b) —
   * KPIs (volume, session count, duration, PR count) each with a delta vs.
   * the previous period, the volume-trend series, the muscle-group
   * distribution (`computeMuscleGroupDistribution`), and personal records
   * (`computePersonalRecords`, Epley estimated 1RM). Distribution and PRs
   * are scoped to the CURRENT period only.
   *
   * Bounded, no N+1: (1) one date-ranged query over the caller's completed
   * sessions spanning `previousStart..currentEnd` in a single WHERE, scoped
   * by (tenantId, userId); (2)+(3) two bounded `inArray` follow-ups
   * (session_exercises, set_records) reused both for per-session volume and
   * for the distribution/PR aggregation — no additional queries — skipped
   * entirely when no session falls in range, mirroring
   * `getDashboardSummary`'s empty-state short circuit.
   */
  async getStatsRange(
    tenantId: string,
    userId: string,
    range: "week" | "month" | "year",
    now: Date = new Date()
  ): Promise<StatsSummaryDTO> {
    const { currentStart, currentEnd, previousStart, previousEnd } = statsRangeBounds(range, now);

    const sessionRows = (await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          gte(workoutSessions.completedAt, previousStart),
          lte(workoutSessions.completedAt, currentEnd)
        )
      )
      .orderBy(desc(workoutSessions.completedAt))) as WorkoutSessionRow[];

    if (sessionRows.length === 0) {
      return emptyStatsSummary(range);
    }

    const sessionIds = sessionRows.map((row) => row.id);
    const exerciseRows = (await this.db
      .select()
      .from(sessionExercises)
      .where(inArray(sessionExercises.workoutSessionId, sessionIds))) as SessionExerciseRow[];

    const exerciseIds = exerciseRows.map((exercise) => exercise.id);
    const setRows =
      exerciseIds.length === 0
        ? []
        : ((await this.db
            .select()
            .from(setRecords)
            .where(inArray(setRecords.sessionExerciseId, exerciseIds))) as SetRecordRow[]);

    const exercisesBySession = new Map<string, SessionExerciseRow[]>();
    for (const exerciseRow of exerciseRows) {
      const current = exercisesBySession.get(exerciseRow.workoutSessionId) ?? [];
      current.push(exerciseRow);
      exercisesBySession.set(exerciseRow.workoutSessionId, current);
    }

    const setsByExercise = new Map<string, SetRecordRow[]>();
    for (const setRow of setRows) {
      const current = setsByExercise.get(setRow.sessionExerciseId) ?? [];
      current.push(setRow);
      setsByExercise.set(setRow.sessionExerciseId, current);
    }

    interface StatsBucketEntry {
      completedAt: Date;
      volumeKg: number;
      durationMin: number;
    }
    const currentEntries: StatsBucketEntry[] = [];
    const previousEntries: StatsBucketEntry[] = [];
    const currentSessionCompletedAt = new Map<string, Date>();

    for (const sessionRow of sessionRows) {
      const completedAt = sessionRow.completedAt!;
      const ownExercises = exercisesBySession.get(sessionRow.id) ?? [];
      const ownSets = ownExercises.flatMap((exercise) => setsByExercise.get(exercise.id) ?? []);
      const session = mapWorkoutSessionRecord(sessionRow, ownExercises, ownSets);
      const volumeKg = computeSessionVolume(session);
      const durationMin = Math.max(0, Math.round((completedAt.getTime() - sessionRow.startedAt.getTime()) / 60000));
      const entry: StatsBucketEntry = { completedAt, volumeKg, durationMin };

      if (completedAt >= currentStart && completedAt <= currentEnd) {
        currentEntries.push(entry);
        currentSessionCompletedAt.set(sessionRow.id, completedAt);
      } else if (completedAt >= previousStart && completedAt <= previousEnd) {
        previousEntries.push(entry);
      }
    }

    // Muscle-group distribution + personal records (Slice 3b) are scoped to
    // the CURRENT period only, reusing the same exercise/set rows already
    // fetched above — no extra queries.
    const distributionInputs: MuscleGroupDistributionExercise[] = [];
    const prSetInputs: PersonalRecordSetInput[] = [];

    for (const exerciseRow of exerciseRows) {
      const sessionCompletedAt = currentSessionCompletedAt.get(exerciseRow.workoutSessionId);
      if (!sessionCompletedAt) {
        continue;
      }

      const ownSets = setsByExercise.get(exerciseRow.id) ?? [];
      const completedSets = ownSets.filter((set) => set.completed);
      const setVolumeKg = completedSets.reduce(
        (sum, set) => sum + (toOptionalNumber(set.weightKg) ?? 0) * (set.actualReps ?? 0),
        0
      );

      distributionInputs.push({
        muscleGroup: (exerciseRow.muscleGroup ?? null) as MuscleGroup | null,
        setCount: completedSets.length,
        volumeKg: setVolumeKg,
      });

      for (const set of ownSets) {
        prSetInputs.push({
          exerciseTitle: exerciseRow.title,
          completed: set.completed,
          weightKg: toOptionalNumber(set.weightKg),
          actualReps: set.actualReps,
          achievedAt: sessionCompletedAt.toISOString(),
        });
      }
    }

    const muscleGroupDistribution = computeMuscleGroupDistribution(distributionInputs);
    const personalRecords = computePersonalRecords(prSetInputs);

    const sum = (entries: StatsBucketEntry[], pick: (entry: StatsBucketEntry) => number): number =>
      entries.reduce((total, entry) => total + pick(entry), 0);

    const ascendingByDate = (entries: StatsBucketEntry[]): number[] =>
      entries
        .slice()
        .sort((left, right) => left.completedAt.getTime() - right.completedAt.getTime())
        .map((entry) => entry.volumeKg);

    const currentVolume = sum(currentEntries, (entry) => entry.volumeKg);
    const previousVolume = sum(previousEntries, (entry) => entry.volumeKg);
    const currentDuration = sum(currentEntries, (entry) => entry.durationMin);
    const previousDuration = sum(previousEntries, (entry) => entry.durationMin);
    const currentCount = currentEntries.length;
    const previousCount = previousEntries.length;

    return {
      range,
      totalVolumeKg: { value: currentVolume, deltaVsPreviousPeriod: delta(currentVolume, previousVolume) },
      sessionCount: { value: currentCount, deltaVsPreviousPeriod: delta(currentCount, previousCount) },
      totalDurationMin: { value: currentDuration, deltaVsPreviousPeriod: delta(currentDuration, previousDuration) },
      // `prCount` has no meaningful previous-period comparison (design.md
      // "KPI deltas" only defines deltas for volume/sessions/duration) —
      // deliberately null, never a fabricated delta.
      prCount: { value: personalRecords.length, deltaVsPreviousPeriod: null },
      volumeTrend: { current: ascendingByDate(currentEntries), previous: ascendingByDate(previousEntries) },
      muscleGroupDistribution,
      personalRecords,
    };
  }

  /**
   * Weekly plan board (09c-v1-progress-dashboard-stats, Slice 4b) — the
   * Monday–Sunday day-state array (done/active/rest/soon) plus prev/next
   * navigation, for the calendar week containing `weekStart`.
   *
   * Bounded, no N+1: (1) one date-ranged query over the caller's completed
   * sessions inside the displayed week, scoped by (tenantId, userId); (2)
   * one lookup of the latest ready plan (for the planned-training-day
   * overlay). Completion counts as "done" regardless of which plan version
   * produced the session — `computeWeeklyPlanVsCompletion` has no notion of
   * plan version, only dates. A week predating the plan/account resolves to
   * an all-rest board (+ any real done day) because `plannedTrainingDays`
   * naturally falls back to 0 when there is no ready plan, with no error.
   */
  async getWeeklyOverview(
    tenantId: string,
    userId: string,
    weekStart: Date,
    now: Date = new Date()
  ): Promise<WeeklyOverviewDTO> {
    const { start, end } = domainUtcWeekBounds(weekStart);

    const sessionRows = (await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed"),
          gte(workoutSessions.completedAt, start),
          lte(workoutSessions.completedAt, end)
        )
      )
      .orderBy(desc(workoutSessions.completedAt))) as WorkoutSessionRow[];

    const planRows = (await this.db
      .select()
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.status, "ready")
        )
      )
      .orderBy(desc(workoutPlans.createdAt))
      .limit(1)) as WorkoutPlanRow[];

    const latestReadyPlan = planRows[0];
    const plannedSessions = latestReadyPlan?.programJson?.weeklySessions ?? [];
    const plannedTrainingDays = plannedSessions.length;

    const completedAtDates = sessionRows
      .map((row) => row.completedAt?.toISOString())
      .filter((iso): iso is string => iso !== undefined);

    const statuses = computeWeeklyPlanVsCompletion({ weekStart: start, completedAtDates, plannedTrainingDays }, now);

    const focusByDayIndex = new Map(plannedSessions.map((session) => [session.day - 1, session.title]));

    const days = statuses.map((status, index) => {
      const date = domainAddUtcDays(start, index);
      return {
        date: date.toISOString().slice(0, 10),
        status,
        focus: index < plannedTrainingDays ? focusByDayIndex.get(index) : undefined,
      };
    });

    return {
      weekStart: start.toISOString().slice(0, 10),
      weekLabel: formatWeekLabel(start, end),
      days,
      previousWeekStart: domainAddUtcDays(start, -7).toISOString().slice(0, 10),
      nextWeekStart: domainAddUtcDays(start, 7).toISOString().slice(0, 10),
    };
  }

  /**
   * Read-only exercise-history reference (09c-v1-progress-dashboard-stats,
   * Slice 4b). `title` is free-text supplied by the caller — it is used only
   * as an ADDITIONAL filter inside the already-(tenantId, userId)-scoped set
   * of the caller's own completed sessions (design.md "Read model boundary:
   * one bounded query per surface"). This is what makes it IDOR-safe: step
   * (1) below never sees another user's session ids, so no crafted `title`
   * in step (2) can ever surface another user's rows.
   *
   * Bounded, no N+1: (1) one bounded page of the caller's completed sessions
   * (`EXERCISE_DETAIL_SESSION_SCAN_LIMIT`); (2) one `inArray` query for
   * `session_exercises` scoped to those session ids AND matching `title`
   * exactly; (3) one `inArray` query for `set_records` on the matched
   * exercise ids. Returns an empty `recentSets` array (never an error) when
   * the exercise has no history — the web layer omits the section entirely
   * in that case (design.md "Exercise detail").
   */
  async getExerciseDetail(tenantId: string, userId: string, title: string): Promise<ExerciseDetailDTO> {
    const sessionRows = (await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "completed")
        )
      )
      .orderBy(desc(workoutSessions.completedAt))
      .limit(EXERCISE_DETAIL_SESSION_SCAN_LIMIT)) as WorkoutSessionRow[];

    if (sessionRows.length === 0) {
      return { exerciseTitle: title, recentSets: [] };
    }

    const sessionIds = sessionRows.map((row) => row.id);
    // #140: Fetch all exercises for the matched sessions and filter by
    // normalized title in JS (consistent with classifyExerciseMuscleGroup
    // and computePersonalRecords). This makes exercise-detail history
    // complete regardless of casing, spacing, or diacritics.
    const allExerciseRows = (await this.db
      .select()
      .from(sessionExercises)
      .where(inArray(sessionExercises.workoutSessionId, sessionIds))) as SessionExerciseRow[];

    const normalizedTarget = normalizeTitle(title);
    const exerciseRows = allExerciseRows.filter(
      (exercise) => normalizeTitle(exercise.title) === normalizedTarget
    );

    if (exerciseRows.length === 0) {
      return { exerciseTitle: title, recentSets: [] };
    }

    const completedAtBySessionId = new Map(
      sessionRows.map((row) => [row.id, row.completedAt!.toISOString()])
    );

    const exerciseIds = exerciseRows.map((exercise) => exercise.id);
    const setRows = (await this.db
      .select()
      .from(setRecords)
      .where(inArray(setRecords.sessionExerciseId, exerciseIds))) as SetRecordRow[];

    const completedAtByExerciseId = new Map(
      exerciseRows.map((exercise) => [exercise.id, completedAtBySessionId.get(exercise.workoutSessionId)])
    );

    interface RecentSetEntry {
      completedAt: string;
      weightKg?: number;
      actualReps?: number;
      rpe?: number;
    }

    const recentSets: RecentSetEntry[] = [];
    for (const set of setRows) {
      const completedAt = completedAtByExerciseId.get(set.sessionExerciseId);
      if (completedAt === undefined) {
        continue;
      }
      recentSets.push({
        completedAt,
        weightKg: toOptionalNumber(set.weightKg),
        actualReps: set.actualReps ?? undefined,
        rpe: set.rpe ?? undefined,
      });
    }

    recentSets.sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime());
    recentSets.splice(EXERCISE_DETAIL_RECENT_SETS_LIMIT);

    return { exerciseTitle: title, recentSets };
  }

  private async findLatestActiveSession(
    tenantId: string,
    userId: string
  ): Promise<WorkoutSessionRow | undefined> {
    const rows = await this.db
      .select()
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.tenantId, tenantId),
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.status, "active")
        )
      )
      .orderBy(desc(workoutSessions.startedAt))
      .limit(1);

    return rows[0] as WorkoutSessionRow | undefined;
  }

  /**
   * Resolves the display label of an active session's plan for the conflict
   * signal (#93 / risk-CRITICAL). Scoped to (tenantId, userId, planId) so a
   * user can never learn another tenant's/user's plan name. A null stored name
   * is resolved through `defaultPlanName(name, createdAt)` — the same rule the
   * list/detail read paths apply — so the client always receives a non-empty
   * label. Returns undefined only when the plan row is unexpectedly missing.
   */
  private async findActivePlanName(
    tenantId: string,
    userId: string,
    workoutPlanId: string
  ): Promise<string | undefined> {
    const rows = await this.db
      .select({ name: workoutPlans.name, createdAt: workoutPlans.createdAt })
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.id, workoutPlanId)
        )
      );

    const row = rows[0];
    if (!row) {
      return undefined;
    }

    return defaultPlanName(row.name, row.createdAt);
  }

  private async findReadyPlan(
    tenantId: string,
    userId: string,
    workoutPlanId: string
  ): Promise<WorkoutPlanRow | undefined> {
    const rows = await this.db
      .select()
      .from(workoutPlans)
      .where(
        and(
          eq(workoutPlans.tenantId, tenantId),
          eq(workoutPlans.userId, userId),
          eq(workoutPlans.id, workoutPlanId),
          eq(workoutPlans.status, "ready")
        )
      );

    return rows[0] as WorkoutPlanRow | undefined;
  }

  private async insertSessionExercises(
    tx: StartTx,
    workoutSessionId: string,
    exercises: WorkoutExercise[]
  ): Promise<SessionExerciseRow[]> {
    if (exercises.length === 0) {
      return [];
    }

    const rows = await tx
      .insert(sessionExercises)
      .values(
        exercises.map((exercise, exerciseIndex) => ({
          workoutSessionId,
          exerciseIndex,
          title: exercise.name,
          restSeconds: exercise.restSeconds,
          notes: combineExerciseNotes(exercise),
          muscleGroup: classifyExerciseMuscleGroup(exercise.name),
        }))
      )
      .returning();

    return rows as SessionExerciseRow[];
  }

  private async insertSetRecords(
    tx: StartTx,
    exerciseRows: SessionExerciseRow[],
    exercises: WorkoutExercise[]
  ): Promise<SetRecordRow[]> {
    const values = exerciseRows.flatMap((exerciseRow) => {
      const sourceExercise = exercises[exerciseRow.exerciseIndex];
      if (!sourceExercise) {
        return [];
      }

      return Array.from({ length: sourceExercise.sets }, (_, setIndex) => ({
        sessionExerciseId: exerciseRow.id,
        setIndex,
        targetReps: sourceExercise.reps,
        completed: false,
      }));
    });

    if (values.length === 0) {
      return [];
    }

    const rows = await tx.insert(setRecords).values(values).returning();
    return rows as SetRecordRow[];
  }
}

function mapWorkoutSessionRecord(
  sessionRow: WorkoutSessionRow,
  exerciseRows: SessionExerciseRow[],
  setRows: SetRecordRow[]
): WorkoutSessionRecord {
  const setsByExerciseId = new Map<string, SetRecordDTO[]>();

  for (const setRow of setRows) {
    const current = setsByExerciseId.get(setRow.sessionExerciseId) ?? [];
    current.push({
      id: setRow.id,
      sessionExerciseId: setRow.sessionExerciseId,
      setIndex: setRow.setIndex,
      targetReps: setRow.targetReps,
      actualReps: setRow.actualReps ?? undefined,
      weightKg: toOptionalNumber(setRow.weightKg),
      rpe: setRow.rpe ?? undefined,
      completed: setRow.completed,
      notes: setRow.notes ?? undefined,
    });
    setsByExerciseId.set(setRow.sessionExerciseId, current);
  }

  const exercises: SessionExerciseRecord[] = exerciseRows
    .slice()
    .sort((left, right) => left.exerciseIndex - right.exerciseIndex)
    .map((exerciseRow) => ({
      id: exerciseRow.id,
      workoutSessionId: exerciseRow.workoutSessionId,
      exerciseIndex: exerciseRow.exerciseIndex,
      title: exerciseRow.title,
      restSeconds: exerciseRow.restSeconds,
      notes: exerciseRow.notes ?? undefined,
      setRecords: (setsByExerciseId.get(exerciseRow.id) ?? [])
        .slice()
        .sort((left, right) => left.setIndex - right.setIndex),
    }));

  return {
    id: sessionRow.id,
    workoutPlanId: sessionRow.workoutPlanId,
    status: sessionRow.status,
    day: sessionRow.day ?? undefined,
    exercises,
    startedAt: sessionRow.startedAt.toISOString(),
    completedAt: sessionRow.completedAt?.toISOString() ?? undefined,
  };
}

function combineExerciseNotes(exercise: WorkoutExercise): string | null {
  const notes = [exercise.notes, exercise.substitutionNote].filter(
    (value): value is string => typeof value === "string" && value.trim() !== ""
  );
  return notes.length === 0 ? null : notes.join("\n\n");
}

function toOptionalNumber(value: number | string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  return typeof value === "number" ? value : Number(value);
}
