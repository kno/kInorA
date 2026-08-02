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

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "#2563eb",
  warn: "#d97706",
  error: "#dc2626",
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
    <div style={{ maxWidth: 960 }}>
      <form onSubmit={handleApply} className="kin-card" style={{ marginBottom: "1rem" }}>
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div>
            <label htmlFor="logs-level" style={{ display: "block", marginBottom: "0.25rem" }}>
              {t("filters.level")}
            </label>
            <select
              id="logs-level"
              data-testid="logs-filter-level"
              value={level}
              onChange={(e) => setLevel(e.target.value as LogLevel | "")}
              className="kin-input"
              style={{ width: "100%" }}
            >
              <option value="">{t("filters.levelAll")}</option>
              {LOG_LEVELS.map((value) => (
                <option key={value} value={value}>
                  {t(`level.${value}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="logs-event" style={{ display: "block", marginBottom: "0.25rem" }}>
              {t("filters.event")}
            </label>
            <input
              id="logs-event"
              data-testid="logs-filter-event"
              type="text"
              value={event}
              onChange={(e) => setEvent(e.target.value)}
              className="kin-input"
              style={{ width: "100%" }}
              placeholder={t("filters.eventPlaceholder")}
            />
          </div>

          <div>
            <label htmlFor="logs-tenant" style={{ display: "block", marginBottom: "0.25rem" }}>
              {t("filters.tenantId")}
            </label>
            <input
              id="logs-tenant"
              data-testid="logs-filter-tenant"
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="kin-input"
              style={{ width: "100%" }}
              placeholder={t("filters.tenantIdPlaceholder")}
            />
          </div>

          <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label htmlFor="logs-from" style={{ display: "block", marginBottom: "0.25rem" }}>
                {t("filters.from")}
              </label>
              <input
                id="logs-from"
                data-testid="logs-filter-from"
                type="datetime-local"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="kin-input"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label htmlFor="logs-to" style={{ display: "block", marginBottom: "0.25rem" }}>
                {t("filters.to")}
              </label>
              <input
                id="logs-to"
                data-testid="logs-filter-to"
                type="datetime-local"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="kin-input"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <button
            type="submit"
            data-testid="logs-apply"
            disabled={loading}
            className="kin-btn kin-btn--primary"
          >
            {loading ? t("filters.applying") : t("filters.apply")}
          </button>
        </div>
      </form>

      {status.kind === "error" && (
        <p role="alert" style={{ color: "red" }}>
          {status.message}
        </p>
      )}

      {applied && status.kind !== "error" && events.length === 0 ? (
        <p data-testid="logs-empty" className="kin-muted">
          {t("empty")}
        </p>
      ) : null}

      {!applied ? (
        <p data-testid="logs-empty" className="kin-muted">
          {t("empty")}
        </p>
      ) : null}

      {events.length > 0 && (
        <div className="kin-card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{t("columns.time")}</th>
                <th style={{ textAlign: "left" }}>{t("columns.level")}</th>
                <th style={{ textAlign: "left" }}>{t("columns.event")}</th>
                <th style={{ textAlign: "left" }}>{t("columns.tenant")}</th>
                <th style={{ textAlign: "left" }}>{t("columns.actor")}</th>
                <th style={{ textAlign: "left" }}>{t("columns.outcome")}</th>
                <th style={{ textAlign: "left" }}>{t("columns.metadata")}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((row) => (
                <tr key={row.id} data-testid="log-row">
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                  <td>
                    <span
                      data-testid="log-level"
                      style={{ color: LEVEL_COLOR[row.level], fontWeight: 600 }}
                    >
                      {t(`level.${row.level}`)}
                    </span>
                  </td>
                  <td>{row.event}</td>
                  <td title={row.tenantId ?? undefined} style={{ fontFamily: "monospace" }}>
                    {row.tenantId ? `${row.tenantId.slice(0, 8)}…` : "—"}
                  </td>
                  <td title={row.actorUserId ?? undefined} style={{ fontFamily: "monospace" }}>
                    {row.actorUserId ? `${row.actorUserId.slice(0, 8)}…` : "—"}
                  </td>
                  <td>{row.outcome ?? "—"}</td>
                  <td style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(row.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {nextCursor && (
            <button
              type="button"
              data-testid="logs-load-more"
              className="kin-btn"
              style={{ marginTop: "0.75rem" }}
              onClick={handleLoadMore}
              disabled={loading}
            >
              {loading ? t("loadingMore") : t("loadMore")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
