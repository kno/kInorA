"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type { ClientSummaryDTO } from "@kinora/contracts";
import type { InviteClientResult } from "./trainer-client-types";
import {
  adherenceLabel,
  displayName,
  initialsOf,
  matchesFilter,
  matchesSearch,
  recencyLabel,
  sessionRecency,
  type RosterFilter,
} from "./roster-format";
import styles from "./clients-workspace.module.css";

export interface ClientsWorkspaceClientProps {
  clients: ClientSummaryDTO[];
  /** Set when the initial server-side fetch failed (network/API error, not "forbidden" — the page handles that state itself). */
  initialError?: string | null;
  /** The client the workspace currently shows on the right, if resolved. */
  selectedClientUserId?: string;
  /** Server-rendered identity + tabs header for the selected client (built from `ClientDetailHeader`). */
  detailHeader?: React.ReactNode;
  /** Server-rendered Dashboard/Progress/Plan body for the selected client. */
  detailBody?: React.ReactNode;
  /** `true` when `?client=` named a real `clientUserId` that isn't in this trainer's roster. */
  detailNotFound?: boolean;
  inviteClientAction: (email: string) => Promise<InviteClientResult>;
}

const DESKTOP_QUERY = "(min-width: 900px)";

/**
 * Whether the viewport is wide enough to show the two-column workspace.
 * Defaults to `true` (desktop) for SSR/first paint — the server always
 * renders the workspace markup, and this only affects which URL a roster
 * row's links point at once the client has hydrated and can read the real
 * viewport (progressive enhancement, mirrors the CSS breakpoint in
 * `clients-workspace.module.css` that hides `.detailPanel` below 900px).
 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(true);

  React.useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    setIsDesktop(mql.matches);
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isDesktop;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

interface InviteSheetProps {
  triggerRef: React.RefObject<HTMLElement | null>;
  inviteClientAction: (email: string) => Promise<InviteClientResult>;
  onClose: () => void;
}

/**
 * The "Invite client" modal sheet (replaces the always-visible inline invite
 * card from #458 — the mock opens this from the header CTA). A real dialog:
 * `role="dialog"` + `aria-modal`, a focus trap, Escape/backdrop close, and
 * focus restored to the trigger on close — the SAME contract `PlanList`'s
 * `ConfirmDialog` established for #412, reimplemented here (not imported:
 * that component isn't exported for cross-route reuse, and the trap logic is
 * ~10 lines) rather than left partial as `plans.archive`'s dialog once was.
 */
function InviteSheet({ triggerRef, inviteClientAction, onClose }: InviteSheetProps) {
  const t = useTranslations();
  const dialogRef = React.useRef<HTMLFormElement>(null);
  const emailInputRef = React.useRef<HTMLInputElement>(null);
  const [email, setEmail] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [statusTone, setStatusTone] = React.useState<"status" | "alert">("status");

  React.useEffect(() => {
    emailInputRef.current?.focus();
    const trigger = triggerRef.current;
    return () => {
      if (trigger?.isConnected) trigger.focus();
    };
  }, [triggerRef]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusableElements(dialogRef.current);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const trimmedEmail = email.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmedEmail || submitting) return;

    setSubmitting(true);
    setStatusMessage(null);
    try {
      const result = await inviteClientAction(trimmedEmail);
      if (result.kind === "ok") {
        setStatusTone("status");
        setStatusMessage(t("clients.inviteSuccess"));
        setEmail("");
      } else {
        setStatusTone("alert");
        setStatusMessage(
          result.message === "client_already_assigned"
            ? t("clients.inviteErrorAlreadyAssigned")
            : result.message === "client_not_found"
              ? t("clients.inviteErrorNotFound")
              : t("clients.inviteErrorGeneric"),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.sheetOverlay} onKeyDown={handleKeyDown} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-sheet-title"
        data-testid="invite-sheet"
        className={`kin-card ${styles.sheetCard}`}
        onSubmit={handleSubmit}
      >
        <div className={styles.sheetHead}>
          <div>
            <p className={styles.eyebrow}>{t("clients.invite.eyebrow")}</p>
            <h2 id="invite-sheet-title" className="kin-title">
              {t("clients.inviteTitle")}
            </h2>
            <p className="kin-text kin-muted">{t("clients.invite.description")}</p>
          </div>
          <button
            type="button"
            className={`kin-btn kin-btn--ghost ${styles.closeBtn}`}
            aria-label={t("clients.invite.closeAria")}
            data-testid="invite-sheet-close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <div className="kin-field">
          <label className="kin-label" htmlFor="invite-sheet-email">
            {t("clients.inviteEmailLabel")}
          </label>
          <input
            id="invite-sheet-email"
            ref={emailInputRef}
            className="kin-input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
        </div>

        {statusMessage && (
          <p role={statusTone === "alert" ? "alert" : "status"} className="kin-text">
            {statusMessage}
          </p>
        )}

        <div className={styles.sheetActions}>
          <button type="button" className="kin-btn kin-btn--ghost" data-testid="invite-sheet-cancel" onClick={onClose}>
            {t("clients.invite.cancel")}
          </button>
          <button
            type="submit"
            className="kin-btn kin-btn--accent"
            disabled={submitting || !trimmedEmail}
          >
            {t("clients.inviteSubmit")}
          </button>
        </div>
      </form>
    </div>
  );
}

export function ClientsWorkspaceClient({
  clients,
  initialError = null,
  selectedClientUserId,
  detailHeader,
  detailBody,
  detailNotFound = false,
  inviteClientAction,
}: ClientsWorkspaceClientProps) {
  const t = useTranslations();
  const isDesktop = useIsDesktop();
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<RosterFilter>("all");
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const inviteTriggerRef = React.useRef<HTMLElement | null>(null);
  // Deterministic "now" fixed at first render — the roster's recency labels
  // must not silently drift ("Session today" -> "Session yesterday") mid-
  // session while the trainer is looking at the same page.
  const now = React.useRef(new Date()).current;

  const error = initialError;
  const visibleClients = clients.filter((client) => matchesFilter(client, filter) && matchesSearch(client, search));

  function openSheet(trigger: HTMLElement) {
    inviteTriggerRef.current = trigger;
    setSheetOpen(true);
  }

  function rowHref(clientUserId: string, tab?: string) {
    if (!isDesktop) {
      return `/clients/${clientUserId}${tab ? `?tab=${tab}` : ""}`;
    }
    return `/clients?client=${clientUserId}${tab ? `&tab=${tab}` : ""}`;
  }

  return (
    <main className="kin-page" data-testid="clients-page">
      <div className={styles.frame}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>{t("clients.eyebrow")}</p>
            <h1 className="kin-title">{t("clients.pageTitle")}</h1>
            <p className={`kin-text kin-muted ${styles.topbarLead}`}>{t("clients.pageDescription")}</p>
          </div>
          <div className={styles.topbarActions}>
            <button
              type="button"
              className="kin-btn kin-btn--accent"
              onClick={(e) => openSheet(e.currentTarget)}
            >
              {t("clients.inviteCta")}
            </button>
          </div>
        </header>

        {error && !clients.length && (
          <p role="alert" className={`kin-card ${styles.stateCard}`}>
            {t("clients.loadError")}
          </p>
        )}

        {!error && clients.length === 0 && (
          <section className={`kin-card kin-card--center ${styles.emptyState}`} data-testid="clients-empty">
            <p className="kin-title">{t("clients.emptyTitle")}</p>
            <p className="kin-text kin-muted">{t("clients.emptyState")}</p>
            <button type="button" className="kin-btn kin-btn--accent" onClick={(e) => openSheet(e.currentTarget)}>
              {t("clients.inviteCta")}
            </button>
          </section>
        )}

        {clients.length > 0 && (
          <div className={styles.workspace}>
            <section className={`kin-surface ${styles.rosterPanel}`} aria-label={t("clients.listAria")}>
              <div className={styles.panelHead}>
                <h2 className="kin-title">{t("clients.rosterTitle")}</h2>
              </div>

              <div className={styles.rosterTools}>
                <div className={styles.searchWrap}>
                  <svg
                    className={styles.searchIcon}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-4-4" />
                  </svg>
                  <input
                    type="search"
                    className={`kin-input ${styles.searchInput}`}
                    aria-label={t("clients.roster.searchLabel")}
                    placeholder={t("clients.roster.searchPlaceholder")}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className={styles.rosterSummary}>
                  <span className={styles.rosterCount}>{t("clients.rosterCount", { count: visibleClients.length })}</span>
                  <div className={styles.filters} role="group" aria-label={t("clients.roster.filtersAria")}>
                    {(["all", "active", "invited"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={styles.filter}
                        aria-pressed={filter === option}
                        data-testid={`client-filter-${option}`}
                        onClick={() => setFilter(option)}
                      >
                        {option === "all" ? t("clients.roster.filters.all") : t(`clients.status.${option}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {visibleClients.length === 0 ? (
                <p className={styles.listEmpty} data-testid="clients-no-matches">
                  {t("clients.roster.noMatches")}
                </p>
              ) : (
                <ul className={styles.list} role="listbox" aria-label={t("clients.listAria")}>
                  {visibleClients.map((client) => {
                    const isActive = client.status === "active";
                    const isSelected = client.clientUserId === selectedClientUserId;
                    const recency =
                      client.status === "invited"
                        ? t("clients.roster.pendingInvite")
                        : recencyLabel(sessionRecency(client.lastSessionAt, now), t);
                    const adherence = client.status === "invited" ? "—" : adherenceLabel(client.completionRate, t);

                    return (
                      <li key={client.clientUserId}>
                        <a
                          href={rowHref(client.clientUserId)}
                          role="option"
                          aria-selected={isSelected}
                          data-testid="client-row"
                          className={`${styles.rowSelect}${isSelected ? ` ${styles.rowSelectActive}` : ""}`}
                        >
                          <span className={styles.avatar} aria-hidden="true">
                            {initialsOf(client)}
                          </span>
                          <span className={styles.identity}>
                            <span className={styles.name}>{displayName(client)}</span>
                            <span className={styles.email}>{client.email}</span>
                            <span className={styles.meta}>
                              <span>{recency}</span>
                              <span className={styles.metaDot} aria-hidden="true" />
                              <span>{adherence}</span>
                            </span>
                          </span>
                          <span
                            className={`${styles.status} ${isActive ? styles.statusActive : styles.statusInvited}`}
                          >
                            {t(`clients.status.${client.status}`)}
                          </span>
                        </a>
                        <span
                          className={styles.rowActions}
                          aria-label={t("clients.quickActionsAria", { email: client.email })}
                        >
                          <a className="kin-btn kin-btn--ghost" href={rowHref(client.clientUserId, "dashboard")}>
                            {t("clients.quickActions.dashboard")}
                          </a>
                          <a className="kin-btn kin-btn--ghost" href={rowHref(client.clientUserId, "progress")}>
                            {t("clients.quickActions.progress")}
                          </a>
                          <a
                            className="kin-btn kin-btn--ghost"
                            href={rowHref(client.clientUserId, "plan")}
                            aria-disabled={!isActive}
                          >
                            {t("clients.quickActions.plan")}
                          </a>
                          <a
                            className="kin-btn kin-btn--accent"
                            href={`/clients/${client.clientUserId}/create-plan`}
                            aria-disabled={!isActive}
                          >
                            {t("clients.createPlanCta")}
                          </a>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className={`kin-surface ${styles.detailPanel}`} aria-label={t("clients.workspace.detailAria")}>
              {detailNotFound ? (
                <p className="kin-text kin-muted" data-testid="client-detail-not-found">
                  {t("clients.detail.notFound")}
                </p>
              ) : (
                <>
                  {detailHeader}
                  {detailBody}
                </>
              )}
            </section>
          </div>
        )}
      </div>

      {sheetOpen && (
        <InviteSheet
          triggerRef={inviteTriggerRef}
          inviteClientAction={inviteClientAction}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </main>
  );
}

export default ClientsWorkspaceClient;
