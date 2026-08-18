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

  const days = Math.floor((now.getTime() - then.getTime()) / MS_PER_DAY);
  if (days <= 0) return { kind: "today" };
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
 * The roster row's adherence copy. `null`/`undefined` (invited client, or an
 * active one with no completed sessions) renders an honest dash — never a
 * fabricated percentage (#420).
 */
export function adherenceLabel(completionRate: number | null | undefined, t: Translator): string {
  return completionRate == null ? "—" : t("clients.roster.adherence", { percent: completionRate });
}
