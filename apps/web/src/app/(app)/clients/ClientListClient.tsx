"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ClientSummaryDTO } from "@kinora/contracts";
import type { InviteClientResult } from "./trainer-client-types";

export interface ClientListClientProps {
  initialClients: ClientSummaryDTO[];
  /** Set when the initial server-side fetch failed (network/API error, not "forbidden" — the page handles that state itself). */
  initialError?: string | null;
  inviteClientAction: (email: string) => Promise<InviteClientResult>;
}

/**
 * Trainer client-list surface (15a-v2-trainer-account-access, Slice 5).
 *
 * Minimal, functional client-management surface: lists assigned clients
 * (`GET /trainer/clients`), an invite-by-email form (`POST
 * /trainer/clients/invite`), and a per-client "create plan" entry linking to
 * the client-owned plan-creation form (`/clients/:clientUserId/create-plan`).
 * Mirrors `MemoryPageClient`'s state-machine shape (loading/empty/error/list).
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

  return (
    <main className="kin-page" data-testid="clients-page">
      <header>
        <h1 className="kin-title">{t("clients.pageTitle")}</h1>
        <p className="kin-text kin-muted">{t("clients.pageDescription")}</p>
      </header>

      <section className="kin-card" aria-label={t("clients.inviteFormAria")}>
        <h2 className="kin-title">{t("clients.inviteTitle")}</h2>
        <form onSubmit={handleInvite}>
          <label htmlFor="invite-email">{t("clients.inviteEmailLabel")}</label>
          <input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
          />
          <button type="submit" className="kin-btn kin-btn--accent" disabled={submitting || !trimmedEmail}>
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
        <p role="alert" className="kin-text">
          {t("clients.loadError")}
        </p>
      )}

      {!error && clients.length === 0 && (
        <p className="kin-text kin-muted" data-testid="clients-empty">
          {t("clients.emptyState")}
        </p>
      )}

      {clients.length > 0 && (
        <ul className="kin-list" aria-label={t("clients.listAria")}>
          {clients.map((client) => (
            <li key={client.clientUserId} data-testid="client-row">
              <span>{client.email}</span>
              <span>{t(`clients.status.${client.status}`)}</span>
              <a
                className="kin-btn"
                href={`/clients/${client.clientUserId}/create-plan`}
              >
                {t("clients.createPlanCta")}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
