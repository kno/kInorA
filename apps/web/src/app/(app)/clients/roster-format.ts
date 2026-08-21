/**
 * Pure formatting helpers for the trainer roster's rich rows (GH #447 follow-
 * up — the workspace/master-detail closeout). No framework or i18n import:
 * these return either plain values or a small discriminated "kind" the
 * caller maps to a translated string with `useTranslations`, mirroring how
 * `ClientDetailSections` keeps its own DTO → copy mapping out of the render
 * tree ("no invented data" — a `null`/`undefined` DTO field must render an
 * honest dash, never a fabricated number, per #420).
 */
import type { ClientSummaryDTO } from "@kinora/contracts";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** The local-part of an email address ("elena.lopez" from "elena.lopez@correo.com"). */
export function localPart(email: string): string {
  return email.split("@")[0] ?? email;
}

/**
 * The name to show in a roster row: `ClientSummaryDTO.name` when present,
 * otherwise the email's local-part (never the raw email — the mock styles
 * this slot as a name, and showing the full address twice next to the email
 * line below it would be redundant).
 */
export function displayName(client: Pick<ClientSummaryDTO, "name" | "email">): string {
  return client.name ?? localPart(client.email);
}

/** Two-character avatar initials, from the display name when there is one, else the email. */
export function initialsOf(client: Pick<ClientSummaryDTO, "name" | "email">): string {
  const source = client.name?.trim() || client.email;
  return source.slice(0, 2).toUpperCase();
}

export type SessionRecency =
  | { kind: "none" }
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "daysAgo"; days: number };

/**
 * Classifies how recent a client's last completed session was, relative to
 * `now`. `lastSessionAt` is `null`/`undefined`-safe (an invited client, or an
 * active one with no completed sessions yet, has none) — those collapse to
 * `{ kind: "none" }` rather than a fabricated "no sessions" number.
 */
export function sessionRecency(lastSessionAt: string | null | undefined, now: Date): SessionRecency {
  if (!lastSessionAt) return { kind: "none" };

  const then = new Date(lastSessionAt);
  if (Number.isNaN(then.getTime())) return { kind: "none" };

  // Clamp to >= 0: a `lastSessionAt` in the future (clock skew between the
  // client's device and the server, or a slightly-ahead server clock) must
  // never produce a negative day count. This is intentional, not a bug — a
  // future timestamp deliberately reads as "today" rather than surfacing a
  // nonsensical "-1 days ago" (GH #460 review).
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY));
  if (days === 0) return { kind: "today" };
  if (days === 1) return { kind: "yesterday" };
  return { kind: "daysAgo", days };
}

/**
 * A roster-row status filter (mirrors the mock's segmented control: Todos /
 * Activos / Invitados). Deliberately narrower than `TrainerAssignmentStatus`
 * — a `revoked` assignment is never returned in the roster today, and "all"
 * already covers whatever the API sends.
 */
export type RosterFilter = "all" | "active" | "invited";

/** Case/locale-insensitive substring match over name, email and email local-part. */
export function matchesSearch(client: ClientSummaryDTO, term: string): boolean {
  const needle = term.trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack = `${client.name ?? ""} ${client.email} ${localPart(client.email)}`.toLocaleLowerCase();
  return haystack.includes(needle);
}

export function matchesFilter(client: ClientSummaryDTO, filter: RosterFilter): boolean {
  return filter === "all" || client.status === filter;
}

export type Translator = (key: string, values?: Record<string, string | number>) => string;

/** Maps a {@link SessionRecency} to its translated roster-row copy. */
export function recencyLabel(recency: SessionRecency, t: Translator): string {
  switch (recency.kind) {
    case "none":
      return t("clients.roster.recency.none");
    case "today":
      return t("clients.roster.recency.today");
    case "yesterday":
      return t("clients.roster.recency.yesterday");
    case "daysAgo":
      return t("clients.roster.recency.daysAgo", { days: recency.days });
  }
}

/**
 * Formats an ISO timestamp (or date-only string) as a short, locale-aware
 * date — `"29 jun 2026"` (es) / `"Jun 29, 2026"` (en) — never the raw ISO
 * string a trainer would otherwise see in the Dashboard tab's RPE-trend and
 * recent-sessions lists. Uses UTC so a date-only input (`"2026-08-17"`) never
 * shifts by a day under a negative-offset locale. An unparsable value falls
 * back to itself rather than throwing or rendering "Invalid Date".
 */
export function formatShortDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    date,
  );
}

/**
 * The roster row's adherence copy. `null`/`undefined` (invited client, or an
 * active one with no completed sessions) renders an honest dash — never a
 * fabricated percentage (#420).
 */
export function adherenceLabel(completionRate: number | null | undefined, t: Translator): string {
  return completionRate == null ? "—" : t("clients.roster.adherence", { percent: completionRate });
}
