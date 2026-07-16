/**
 * /history — Session History page.
 *
 * Async server component rendering completed workout sessions, newest-first,
 * via `getWorkoutHistoryAction` (offset-based pagination, default page size
 * 20 — see `WorkoutHistoryQuery`).
 *
 * Sync-independent (spec: "History available without pending sync
 * activity") — this page and its action never read the offline mutation
 * queue or session snapshot cache; it renders whatever the API returns for
 * previously synced, completed sessions.
 *
 * searchParams is a Promise in Next 15+ (async searchParams). Await it.
 */
import { getTranslations } from "next-intl/server";
import type { WorkoutHistoryEntry } from "@kinora/contracts";
import { getWorkoutHistoryAction } from "./actions";

const PAGE_SIZE = 20;

interface HistoryPageProps {
  searchParams: Promise<{ offset?: string }>;
}

function sessionDurationMinutes(entry: WorkoutHistoryEntry): number | undefined {
  const { startedAt, completedAt } = entry.session;
  if (!completedAt) {
    return undefined;
  }

  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return durationMs > 0 ? Math.round(durationMs / (60 * 1000)) : 0;
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const t = await getTranslations();
  const offset = Number(params.offset ?? 0) || 0;

  const result = await getWorkoutHistoryAction({ limit: PAGE_SIZE, offset });
  const entries = result.kind === "ok" ? result.entries : [];

  return (
    <main className="kin-page">
      <h1 className="kin-title">{t("history.title")}</h1>
      <p className="kin-text kin-muted">{t("history.description")}</p>

      {entries.length === 0 ? (
        <div className="kin-card kin-card--center">
          <p className="kin-text kin-muted">{t("history.empty")}</p>
        </div>
      ) : (
        <ul>
          {entries.map((entry) => {
            const durationMinutes = sessionDurationMinutes(entry);
            const exerciseCount = entry.session.exercises.length;

            return (
              <li key={entry.session.id} className="kin-card">
                <h2 className="kin-text">
                  {entry.session.completedAt
                    ? new Date(entry.session.completedAt).toLocaleDateString()
                    : new Date(entry.session.startedAt).toLocaleDateString()}
                </h2>
                {durationMinutes !== undefined && (
                  <p className="kin-text kin-muted">
                    {t("history.duration", { minutes: durationMinutes })}
                  </p>
                )}
                <p className="kin-text kin-muted">{exerciseCount}</p>
                <p className="kin-text kin-muted">
                  {t("history.totalVolume", { volume: entry.totalVolume })}
                </p>
                {entry.averageRpe !== undefined && (
                  <p className="kin-text kin-muted">
                    {t("history.averageRpe", { rpe: entry.averageRpe })}
                  </p>
                )}
                {entry.trend && (
                  <p className="kin-text kin-muted">
                    {t(`history.trend.${entry.trend.direction}`, {
                      volume: Math.abs(entry.trend.volumeDelta),
                    })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {entries.length === PAGE_SIZE && (
        <a href={`/history?offset=${offset + PAGE_SIZE}`} className="kin-btn kin-btn--ghost">
          {t("history.loadMore")}
        </a>
      )}
    </main>
  );
}
