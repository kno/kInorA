import { and, eq, sql } from "drizzle-orm";
import { planSpecs } from "../schema.js";
import type { Database } from "../client.js";
import type { IntensityBias, PlanSpec } from "@kinora/contracts";

/** A transaction executor compatible with Database — a subset of Database passed inside db.transaction(). */
type DbOrTx = Pick<Database, "insert">;

/**
 * Plan spec persistence repository.
 *
 * A plan_specs row is the confirmed wizard output — the user's training requirements.
 * It is NOT a workout program. The actual workout program (exercises, sets, schedule)
 * is owned by change 08 (ai-plan-generation) and will live in a separate table.
 */
export class PlanSpecRepository {
  constructor(private db: Database) {}

  /**
   * Return a confirmed plan spec by id, scoped to the requesting tenant and user.
   * Returns undefined when:
   * - the spec does not exist
   * - the spec is a draft (confirmed === false)
   * - the spec belongs to a different tenant or user (cross-owner isolation)
   *
   * Used by the generation service to verify the spec is ready before
   * starting LLM generation.
   */
  async findConfirmedById(
    tenantId: string,
    userId: string,
    id: string
  ): Promise<
    | {
        id: string;
        tenantId: string;
        userId: string;
        specJson: PlanSpec;
        confirmed: boolean;
        createdAt: Date;
      }
    | undefined
  > {
    const rows = await this.db
      .select()
      .from(planSpecs)
      .where(
        and(
          eq(planSpecs.tenantId, tenantId),
          eq(planSpecs.userId, userId),
          eq(planSpecs.id, id),
          eq(planSpecs.confirmed, true)
        )
      );
    return rows[0] as
      | {
          id: string;
          tenantId: string;
          userId: string;
          specJson: PlanSpec;
          confirmed: boolean;
          createdAt: Date;
        }
      | undefined;
  }

  /**
   * Insert a confirmed plan_specs row for a given tenant + user.
   * Accepts an optional transaction executor (tx) so callers can run this
   * inside a db.transaction() alongside other statements atomically.
   * Returns the persisted id and the confirmed PlanSpec.
   */
  async create(
    tenantId: string,
    userId: string,
    spec: PlanSpec,
    tx?: DbOrTx
  ): Promise<{ id: string; spec: PlanSpec }> {
    const executor = tx ?? this.db;
    const rows = await executor
      .insert(planSpecs)
      .values({ tenantId, userId, specJson: spec, confirmed: true })
      .returning();
    const row = rows[0] as {
      id: string;
      tenantId: string;
      userId: string;
      specJson: unknown;
      confirmed: boolean;
      createdAt: Date;
    };
    return { id: row.id, spec: row.specJson as PlanSpec };
  }

  /**
   * 14a-v1.1 Slice B1 — in-place, tenant/user-scoped update of
   * `spec_json.daysPerWeek` on an existing confirmed plan_specs row.
   *
   * This is the adherence-adaptation confirm write: the server has already
   * re-derived the reduced `toDays` (the client never supplies a frequency), so
   * this only rewrites the ONE field via `jsonb_set`, leaving every other spec
   * field intact. It is NOT the write-once draft/promote path — no new row, no
   * migration, no draft involvement.
   *
   * Scoped to `(tenantId, userId, id, confirmed = true)`: a cross-tenant or
   * cross-user id matches nothing and is a no-op. Returns the number of rows
   * updated (1 when the caller owns the confirmed spec, 0 otherwise) so the
   * route can treat 0 as a 404 without a separate read.
   */
  async updateSpecDaysPerWeek(
    tenantId: string,
    userId: string,
    id: string,
    toDays: number
  ): Promise<number> {
    const rows = await this.db
      .update(planSpecs)
      .set({
        // Rewrite ONLY spec_json.daysPerWeek; `to_jsonb(int)` keeps it a JSON
        // number and every sibling field is preserved by jsonb_set.
        specJson: sql`jsonb_set(${planSpecs.specJson}, '{daysPerWeek}', to_jsonb(${toDays}::int), true)`,
      })
      .where(
        and(
          eq(planSpecs.tenantId, tenantId),
          eq(planSpecs.userId, userId),
          eq(planSpecs.id, id),
          eq(planSpecs.confirmed, true)
        )
      )
      .returning();
    return rows.length;
  }

  /**
   * 14b-v1.1 — in-place, tenant/user-scoped update of `spec_json.intensityBias`
   * on an existing confirmed plan_specs row. Analogous to `updateSpecDaysPerWeek`:
   * this is the RPE-adaptation confirm write (the LOAD branch of `/adapt`) —
   * the server has already re-derived the ladder-stepped bias, so this only
   * rewrites the ONE field via `jsonb_set`, leaving every other spec field
   * (including `daysPerWeek`) intact.
   *
   * Scoped to `(tenantId, userId, id, confirmed = true)`: a cross-tenant or
   * cross-user id matches nothing and is a no-op. Returns the number of rows
   * updated (1 when the caller owns the confirmed spec, 0 otherwise) so the
   * route can treat 0 as a 404 without a separate read.
   */
  async updateSpecIntensityBias(
    tenantId: string,
    userId: string,
    id: string,
    intensityBias: IntensityBias
  ): Promise<number> {
    const rows = await this.db
      .update(planSpecs)
      .set({
        // Rewrite ONLY spec_json.intensityBias; `to_jsonb(text)` keeps it a
        // JSON string and every sibling field is preserved by jsonb_set.
        specJson: sql`jsonb_set(${planSpecs.specJson}, '{intensityBias}', to_jsonb(${intensityBias}::text), true)`,
      })
      .where(
        and(
          eq(planSpecs.tenantId, tenantId),
          eq(planSpecs.userId, userId),
          eq(planSpecs.id, id),
          eq(planSpecs.confirmed, true)
        )
      )
      .returning();
    return rows.length;
  }
}
