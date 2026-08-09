"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  LOG_LEVELS,
  type LogEvent,
  type LogFilters,
  type LogLevel,
} from "./logs-constants";
import { fetchLogsAction } from "./actions";
import styles from "../admin.module.css";

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

/**
 * Level badge classes. These used to be raw hex literals applied as an inline
 * `color`, which is why levels never matched the product palette; they now
 * resolve through the `--info` / `--warning` / `--danger` design tokens.
 */
const LEVEL_CLASS: Record<LogLevel, string | undefined> = {
  info: styles.levelInfo,
  warn: styles.levelWarn,
  error: styles.levelError,
};

/**
 * LogsView — client component for the /admin/logs observability panel
 * (GH #310, Slice 2). The browser never calls the API directly: every read
 * goes through the `"use server"` action, which proxies to the API with the
 * server-held session token. Imports ONLY the action + the plain constants
 * (never the server-only client module) so `ui-api-guard` passes.
 *
 * Filter controls (level / event / tenant / from / to) drive an Apply query;
 * "Load more" fetches the next page via the opaque `nextCursor` and APPENDS
 * the rows (accumulating the result set).
 */
export function LogsView() {
  const t = useTranslations("logs");

  const [level, setLevel] = useState<LogLevel | "">("");
  const [event, setEvent] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [events, setEvents] = useState<LogEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [applied, setApplied] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  function errorMessage(kind: string): string {
    switch (kind) {
      case "forbidden":
        return t("errors.forbidden");
      case "invalid":
        return t("errors.invalid");
      default:
        return t("errors.generic");
    }
  }

  function currentFilters(cursor?: string): LogFilters {
    return {
      tenantId: tenantId.trim() || undefined,
      level: level || undefined,
      event: event.trim() || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      cursor,
    };
  }

  async function handleApply(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "loading" });
    const result = await fetchLogsAction(currentFilters());
    setApplied(true);
    if (result.kind === "ok") {
      setEvents(result.events);
      setNextCursor(result.nextCursor);
      setStatus({ kind: "idle" });
    } else {
      setEvents([]);
      setNextCursor(undefined);
      setStatus({ kind: "error", message: errorMessage(result.kind) });
    }
  }

  async function handleLoadMore() {
    if (!nextCursor) return;
    setStatus({ kind: "loading" });
    const result = await fetchLogsAction(currentFilters(nextCursor));
    if (result.kind === "ok") {
      setEvents((prev) => [...prev, ...result.events]);
      setNextCursor(result.nextCursor);
      setStatus({ kind: "idle" });
    } else {
      setStatus({ kind: "error", message: errorMessage(result.kind) });
    }
  }

  const loading = status.kind === "loading";

  return (
    <div>
      <section className={`${styles.panel} ${styles.section}`} aria-labelledby="logs-filters-title">
        <div className={styles.panelHead}>
          <h2 id="logs-filters-title">{t("filtersTitle")}</h2>
        </div>
        <form onSubmit={handleApply} className={styles.panelBody}>
          <div className={styles.filters}>
            <div className={styles.field}>
              <label htmlFor="logs-level">{t("filters.level")}</label>
              <select
                id="logs-level"
                data-testid="logs-filter-level"
                value={level}
                onChange={(e) => setLevel(e.target.value as LogLevel | "")}
                className="kin-input"
              >
                <option value="">{t("filters.levelAll")}</option>
                {LOG_LEVELS.map((value) => (
                  <option key={value} value={value}>
                    {t(`level.${value}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label htmlFor="logs-event">{t("filters.event")}</label>
              <input
                id="logs-event"
                data-testid="logs-filter-event"
                type="text"
                value={event}
                onChange={(e) => setEvent(e.target.value)}
                className="kin-input"
                placeholder={t("filters.eventPlaceholder")}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="logs-tenant">{t("filters.tenantId")}</label>
              <input
                id="logs-tenant"
                data-testid="logs-filter-tenant"
                type="text"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="kin-input"
                placeholder={t("filters.tenantIdPlaceholder")}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="logs-from">{t("filters.from")}</label>
              <input
                id="logs-from"
                data-testid="logs-filter-from"
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className={`kin-input ${styles.dateInput}`}
              />
            </div>

            <div className={styles.field}>
              <label htmlFor="logs-to">{t("filters.to")}</label>
              <input
                id="logs-to"
                data-testid="logs-filter-to"
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={`kin-input ${styles.dateInput}`}
              />
            </div>

            <div className={styles.applyCell}>
              <button
                type="submit"
                data-testid="logs-apply"
                disabled={loading}
                className="kin-btn kin-btn--primary"
              >
                {loading ? t("filters.applying") : t("filters.apply")}
              </button>
            </div>
          </div>
        </form>
      </section>

      {/*
       * Three states that must not be confused with one another. Before this
       * change "no query has been run yet" and "the query returned zero rows"
       * rendered the SAME sentence under the SAME test id, so an admin who had
       * not pressed Apply was told there were no matching events. Nothing had
       * been asked of the API at that point.
       */}
      {status.kind === "error" && events.length > 0 && (
        <p className={`${styles.banner} ${styles.bannerDanger}`} role="alert">
          {status.message}
        </p>
      )}

      {status.kind === "error" && events.length === 0 ? (
        <section className={`${styles.panel} ${styles.state} ${styles.stateError}`} role="alert">
          <div className={styles.eyebrow}>{t("errorEyebrow")}</div>
          <p>{status.message}</p>
        </section>
      ) : !applied ? (
        <section
          className={`${styles.panel} ${styles.state} ${styles.stateIdle}`}
          data-testid="logs-idle"
        >
          <div className={styles.eyebrow}>{t("idle.eyebrow")}</div>
          <h2>{t("idle.title")}</h2>
          <p>{t("idle.description")}</p>
        </section>
      ) : events.length === 0 ? (
        <section
          className={`${styles.panel} ${styles.state} ${styles.stateEmpty}`}
          data-testid="logs-empty"
        >
          <div className={styles.eyebrow}>{t("emptyEyebrow")}</div>
          <h2>{t("emptyTitle")}</h2>
          <p>{t("emptyDescription")}</p>
        </section>
      ) : null}

      {events.length > 0 && (
        <section className={styles.panel} aria-labelledby="logs-results-title">
          <div className={styles.panelHead}>
            <h2 id="logs-results-title">{t("resultsTitle")}</h2>
          </div>
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${styles.tableLogs}`}>
              <thead>
                <tr>
                  <th scope="col">{t("columns.time")}</th>
                  <th scope="col">{t("columns.level")}</th>
                  <th scope="col">{t("columns.event")}</th>
                  <th scope="col">{t("columns.tenant")}</th>
                  <th scope="col">{t("columns.actor")}</th>
                  <th scope="col">{t("columns.outcome")}</th>
                  <th scope="col">{t("columns.metadata")}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((row) => (
                  <tr key={row.id} data-testid="log-row">
                    <td className={styles.cellTime}>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>
                      <span
                        data-testid="log-level"
                        className={`${styles.level} ${LEVEL_CLASS[row.level]}`}
                      >
                        {t(`level.${row.level}`)}
                      </span>
                    </td>
                    <td className={styles.cellEvent}>{row.event}</td>
                    <td>
                      {row.tenantId ? (
                        <span className={styles.uuid} title={row.tenantId}>
                          {`${row.tenantId.slice(0, 8)}…`}
                        </span>
                      ) : (
                        <span className={`${styles.uuid} ${styles.uuidNone}`}>—</span>
                      )}
                    </td>
                    <td>
                      {row.actorUserId ? (
                        <span className={styles.uuid} title={row.actorUserId}>
                          {`${row.actorUserId.slice(0, 8)}…`}
                        </span>
                      ) : (
                        <span className={`${styles.uuid} ${styles.uuidNone}`}>—</span>
                      )}
                    </td>
                    {/* `outcome` is free-form text from the API, not an enum,
                        so it is rendered neutrally rather than colour-coded on
                        a guessed value. */}
                    <td>
                      <span className={styles.outcome}>{row.outcome ?? "—"}</span>
                    </td>
                    <td className={styles.meta}>{JSON.stringify(row.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.tableFoot}>
            <span className={styles.note}>{t("cursorNote")}</span>
            {nextCursor && (
              <button
                type="button"
                data-testid="logs-load-more"
                className="kin-btn"
                onClick={handleLoadMore}
                disabled={loading}
              >
                {loading ? t("loadingMore") : t("loadMore")}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
