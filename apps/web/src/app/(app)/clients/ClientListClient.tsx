"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ClientSummaryDTO } from "@kinora/contracts";
import type { InviteClientResult } from "./trainer-client-types";
import styles from "./client-list.module.css";

export interface ClientListClientProps {
  initialClients: ClientSummaryDTO[];
  /** Set when the initial server-side fetch failed (network/API error, not "forbidden" — the page handles that state itself). */
  initialError?: string | null;
  inviteClientAction: (email: string) => Promise<InviteClientResult>;
}

/**
 * Two-character avatar initials from an email local-part. Mirrors
 * `ClientDetailSections.initialsOf` (kept local — this route has no reason
 * to import a client-detail module just for a two-line helper).
 */
function initialsOf(email: string): string {
  return email.slice(0, 2).toUpperCase();
}

/**
 * Trainer client-list surface (15a-v2-trainer-account-access, Slice 5;
 * restyled for GH #447 to match `web-clients.html`'s roster panel: a page
 * header with an "Invite client" CTA, a roster card with a count summary,
 * and client rows built from avatar + identity + status pill + quick
 * actions. Lists assigned clients (`GET /trainer/clients`), an invite-by-email
 * form (`POST /trainer/clients/invite`), and per-client links into the
 * client-owned detail/plan-creation routes.
 *
 * The mock's roster row also shows a last-session note and an adherence
 * percentage, and offers live search/status filtering — none of that is
 * backed by `ClientSummaryDTO` or requested for this pass, so it is
 * intentionally omitted rather than fabricated (project rule — see #420)
 * or added as new functionality (out of scope for this visual-only fix).
 */
export function ClientListClient({
  initialClients,
  initialError = null,
  inviteClientAction,
}: ClientListClientProps) {
  const t = useTranslations();
  const clients = initialClients;
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"status" | "alert">("status");
  const error = initialError;
  const emailInputRef = useRef<HTMLInputElement>(null);

  const trimmedEmail = email.trim();

  async function handleInvite(e: React.FormEvent) {
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

  function focusInviteField() {
    emailInputRef.current?.focus();
  }

  return (
    <main className="kin-page" data-testid="clients-page">
      <div className={styles.frame}>
        <header className={styles.topbar}>
          <div>
            <p className={styles.eyebrow}>{t("clients.eyebrow")}</p>
            <h1 className="kin-title">{t("clients.pageTitle")}</h1>
            <p className={`kin-text kin-muted ${styles.topbarLead}`}>
              {t("clients.pageDescription")}
            </p>
          </div>
          <div className={styles.topbarActions}>
            <button
              type="button"
              className="kin-btn kin-btn--accent"
              onClick={focusInviteField}
            >
              {t("clients.inviteCta")}
            </button>
          </div>
        </header>

        <section
          className={`kin-card ${styles.invitePanel}`}
          aria-label={t("clients.inviteFormAria")}
        >
          <h2 className="kin-title">{t("clients.inviteTitle")}</h2>
          <form className="kin-form" onSubmit={handleInvite}>
            <div className="kin-field">
              <label className="kin-label" htmlFor="invite-email">
                {t("clients.inviteEmailLabel")}
              </label>
              <input
                id="invite-email"
                ref={emailInputRef}
                className="kin-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>
            <button
              type="submit"
              className="kin-btn kin-btn--accent"
              disabled={submitting || !trimmedEmail}
            >
              {t("clients.inviteSubmit")}
            </button>
          </form>
          {statusMessage && (
            <p role={statusTone === "alert" ? "alert" : "status"} className="kin-text">
              {statusMessage}
            </p>
          )}
        </section>

        {error && !clients.length && (
          <p role="alert" className={`kin-card ${styles.stateCard}`}>
            {t("clients.loadError")}
          </p>
        )}

        {!error && clients.length === 0 && (
          <section
            className={`kin-card kin-card--center ${styles.emptyState}`}
            data-testid="clients-empty"
          >
            <p className="kin-title">{t("clients.emptyTitle")}</p>
            <p className="kin-text kin-muted">{t("clients.emptyState")}</p>
            <button
              type="button"
              className="kin-btn kin-btn--accent"
              onClick={focusInviteField}
            >
              {t("clients.inviteCta")}
            </button>
          </section>
        )}

        {clients.length > 0 && (
          <section className={`kin-surface ${styles.roster}`} aria-label={t("clients.listAria")}>
            <div className={styles.rosterHead}>
              <h2 className="kin-title">{t("clients.rosterTitle")}</h2>
              <span className={styles.rosterCount}>
                {t("clients.rosterCount", { count: clients.length })}
              </span>
            </div>
            <ul className={styles.list}>
              {clients.map((client) => {
                const isActive = client.status === "active";
                return (
                  <li key={client.clientUserId} className={styles.row} data-testid="client-row">
                    <span className={styles.avatar} aria-hidden="true">
                      {initialsOf(client.email)}
                    </span>
                    <span className={styles.identity}>
                      <span className={styles.email}>{client.email}</span>
                    </span>
                    <span
                      className={`${styles.status} ${isActive ? styles.statusActive : styles.statusInvited}`}
                    >
                      {t(`clients.status.${client.status}`)}
                    </span>
                    <span
                      className={styles.actions}
                      aria-label={t("clients.quickActionsAria", { email: client.email })}
                    >
                      <a
                        className="kin-btn kin-btn--ghost"
                        href={`/clients/${client.clientUserId}?tab=dashboard`}
                      >
                        {t("clients.quickActions.dashboard")}
                      </a>
                      <a
                        className="kin-btn kin-btn--ghost"
                        href={`/clients/${client.clientUserId}?tab=progress`}
                      >
                        {t("clients.quickActions.progress")}
                      </a>
                      <a
                        className="kin-btn kin-btn--ghost"
                        href={`/clients/${client.clientUserId}?tab=plan`}
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
          </section>
        )}
      </div>
    </main>
  );
}
