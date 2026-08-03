// @ts-check
/**
 * Cron-callable seat-billing reconcile sweep (16c-v3-b2b-seat-billing follow-up).
 *
 * `SeatSyncService.reconcileAllStaleSponsors()` heals Stripe/DB seat-count
 * drift left behind by a swallowed outbound Stripe failure (see
 * `apps/api/src/billing/seat-sync.ts`), but nothing in `apps/api/src` schedules
 * it. This standalone entrypoint is meant to be invoked by an external VPS
 * cron INSIDE the running api container:
 *
 *   docker compose exec -T api node apps/api/dist/scripts/reconcile-seats.mjs
 *
 * ...or, since this script itself is never compiled (see below), directly
 * from the repo root inside the container:
 *
 *   docker compose exec -T api node apps/api/scripts/reconcile-seats.mjs
 *
 * WHY DIST, NOT SRC: this script imports the COMPILED `apps/api/dist/**`
 * output (built by `pnpm build`, the same artifact `pnpm --filter api start`
 * runs as `node dist/index.js`) — never `apps/api/src/**` TypeScript directly
 * and never a second `tsx`-transpiled path. That is the ONE thing this script
 * must get right: reusing `buildSeatSyncService` (`src/billing/seat-sync-
 * factory.ts`) via its compiled `dist/billing/seat-sync-factory.js` output
 * guarantees this cron job wires the EXACT same `SeatSyncService` composition
 * (feature flag, seat-price guard, Stripe gateway fallback) as the running
 * server built via that same factory in `app.ts` — no second, drifting
 * construction path. `dist/` always exists in the prod image (the Dockerfile
 * runtime stage is `COPY --from=build /app /app` after `pnpm build`), so no
 * extra build step is needed inside the container.
 *
 * Lives in `apps/api/scripts/` (not `src/`) for the SAME reason
 * `scripts/e2e-seed.mjs` does — see that file's header comment — to stay
 * outside `.dependency-cruiser.cjs`'s cruise of `apps/api/src` (irrelevant
 * here anyway, since this script only imports compiled `dist/` output, never
 * `pg`/`drizzle` directly).
 *
 * Plain Node ESM (`.mjs` forces ESM even though apps/api has no
 * `"type": "module"`), no build step of its OWN — it just requires
 * `apps/api/dist/**` to already exist (via `pnpm build`).
 *
 * SAFE TO RUN REPEATEDLY: `reconcileAllStaleSponsors` recomputes each drifted
 * sponsor's seat count UNDER a per-sponsor advisory lock (idempotent — see
 * `SeatSyncService`), and a no-op when nothing is drifted. Safe on an empty
 * DB (queries return zero rows, zero iterations, exit 0). NEVER logs secrets
 * — only tenant ids + a reconciled count.
 */

import { createDbClient } from "../dist/db/client.js";
import { buildSeatSyncService } from "../dist/billing/seat-sync-factory.js";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[reconcile-seats] DATABASE_URL is not set. Run this inside the api container " +
        "(docker compose exec -T api node apps/api/scripts/reconcile-seats.mjs), " +
        "where DATABASE_URL is already injected by docker-compose.yml.",
    );
  }

  console.log("[reconcile-seats] sweep started");

  const { db, pool } = createDbClient();
  try {
    const seatSyncService = buildSeatSyncService({ database: db, env: process.env });
    const reconciled = await seatSyncService.reconcileAllStaleSponsors();

    console.log(
      `[reconcile-seats] sweep done: reconciled=${reconciled.length} sponsor(s)`,
    );
  } finally {
    await pool.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      "[reconcile-seats] sweep FAILED:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  });
