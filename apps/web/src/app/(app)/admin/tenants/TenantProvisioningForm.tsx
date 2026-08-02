"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  GRANTABLE_TIERS,
  type GrantableTier,
  type TenantOverrideStatus,
  type TenantSummary,
} from "./tenant-provisioning-constants";
import {
  searchTenantsAction,
  fetchStatusAction,
  grantAction,
  revokeAction,
} from "./actions";

type Feedback =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "saved"; action: "grant" | "revoke" }
  | { kind: "error"; message: string };

/**
 * TenantProvisioningForm — client component for the /admin/tenants panel
 * (GH #307, search-by-name). The browser never calls the API directly: every
 * mutation/read goes through the `"use server"` actions, which proxy to the API
 * with the server-held session token. Imports ONLY the actions + the plain
 * constants (never the server-only client module) so `ui-api-guard` passes.
 */
export function TenantProvisioningForm() {
  const t = useTranslations("tenantProvisioning");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TenantSummary[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState<TenantOverrideStatus | null>(null);

  const [tier, setTier] = useState<GrantableTier>("trainer");
  const [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });

  function errorMessage(kind: string): string {
    switch (kind) {
      case "forbidden":
        return t("errors.forbidden");
      case "not_found":
        return t("errors.notFound");
      case "conflict":
        return t("errors.conflict");
      case "invalid":
        return t("errors.invalid");
      default:
        return t("errors.generic");
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setFeedback({ kind: "idle" });
    if (query.trim().length === 0) {
      setFeedback({ kind: "error", message: t("search.tooShort") });
      return;
    }
    setSearching(true);
    const result = await searchTenantsAction(query.trim());
    setSearching(false);
    if (result.kind === "ok") {
      setResults(result.tenants);
    } else {
      setResults(null);
      setFeedback({ kind: "error", message: errorMessage(result.kind) });
    }
  }

  async function handleSelect(tenantId: string) {
    setFeedback({ kind: "loading" });
    const result = await fetchStatusAction(tenantId);
    if (result.kind === "ok") {
      setSelected(result.status);
      setReason("");
      setStartsAt("");
      setEndsAt("");
      setTier("trainer");
      setFeedback({ kind: "idle" });
    } else {
      setFeedback({ kind: "error", message: errorMessage(result.kind) });
    }
  }

  async function refreshSelected() {
    if (!selected) return;
    const result = await fetchStatusAction(selected.tenant.id);
    if (result.kind === "ok") setSelected(result.status);
  }

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    if (reason.trim().length === 0) {
      setFeedback({ kind: "error", message: t("errors.invalid") });
      return;
    }
    setFeedback({ kind: "loading" });
    const result = await grantAction(selected.tenant.id, {
      tier,
      reason: reason.trim(),
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
    });
    if (result.kind === "ok") {
      setFeedback({ kind: "saved", action: "grant" });
      await refreshSelected();
    } else {
      setFeedback({ kind: "error", message: errorMessage(result.kind) });
    }
  }

  async function handleRevoke() {
    if (!selected) return;
    setFeedback({ kind: "loading" });
    const result = await revokeAction(selected.tenant.id);
    if (result.kind === "ok") {
      setFeedback({ kind: "saved", action: "revoke" });
      await refreshSelected();
    } else {
      setFeedback({ kind: "error", message: errorMessage(result.kind) });
    }
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <form onSubmit={handleSearch} className="kin-card" style={{ marginBottom: "1rem" }}>
        <label htmlFor="tenant-search" style={{ display: "block", marginBottom: "0.25rem" }}>
          {t("search.label")}
        </label>
        <input
          id="tenant-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="kin-input"
          style={{ width: "100%" }}
          placeholder={t("search.placeholder")}
        />
        <button
          type="submit"
          disabled={searching}
          className="kin-btn kin-btn--primary"
          style={{ marginTop: "0.75rem" }}
        >
          {searching ? t("search.searching") : t("search.button")}
        </button>
      </form>

      {results !== null && (
        <div className="kin-card" style={{ marginBottom: "1rem" }}>
          {results.length === 0 ? (
            <p className="kin-muted">{t("search.noResults")}</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: "0.5rem" }}>
              {results.map((tenant) => (
                <li key={tenant.id}>
                  <button
                    type="button"
                    className="kin-btn"
                    style={{ width: "100%", textAlign: "left" }}
                    onClick={() => handleSelect(tenant.id)}
                  >
                    <strong>{tenant.name}</strong>
                    <span className="kin-muted" style={{ display: "block", fontSize: "0.75rem" }}>
                      {tenant.id}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selected && (
        <div className="kin-card" style={{ marginBottom: "1rem" }}>
          <h2 className="kin-title" style={{ fontSize: "1.125rem" }}>
            {selected.tenant.name}
          </h2>
          <p className="kin-muted">
            {t("state.effectiveTier")}: <strong>{selected.effectiveTier}</strong>
          </p>
          <p className="kin-muted">
            {t("state.billingStatus")}: {selected.billingStatus ?? t("state.none")}
          </p>
          {selected.activeOverride ? (
            <p className="kin-muted">
              {t("state.activeOverride")}: <strong>{selected.activeOverride.tier}</strong>
            </p>
          ) : (
            <p className="kin-muted">{t("state.noOverride")}</p>
          )}

          {selected.activeOverride && (
            <button
              type="button"
              className="kin-btn"
              style={{ marginTop: "0.5rem" }}
              onClick={handleRevoke}
              disabled={feedback.kind === "loading"}
            >
              {t("revoke.button")}
            </button>
          )}

          <form onSubmit={handleGrant} style={{ marginTop: "1rem" }}>
            <h3 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>{t("grant.title")}</h3>

            <div style={{ marginBottom: "0.75rem" }}>
              <label htmlFor="grant-tier" style={{ display: "block", marginBottom: "0.25rem" }}>
                {t("grant.tierLabel")}
              </label>
              <select
                id="grant-tier"
                value={tier}
                onChange={(e) => setTier(e.target.value as GrantableTier)}
                className="kin-input"
                style={{ width: "100%" }}
              >
                {GRANTABLE_TIERS.map((value) => (
                  <option key={value} value={value}>
                    {value === "trainer" ? t("grant.tierTrainer") : t("grant.tierGym")}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <label htmlFor="grant-reason" style={{ display: "block", marginBottom: "0.25rem" }}>
                {t("grant.reasonLabel")}
              </label>
              <textarea
                id="grant-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="kin-input"
                style={{ width: "100%" }}
                rows={2}
                placeholder={t("grant.reasonPlaceholder")}
                required
              />
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <label htmlFor="grant-starts" style={{ display: "block", marginBottom: "0.25rem" }}>
                {t("grant.startsAtLabel")}
              </label>
              <input
                id="grant-starts"
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="kin-input"
                style={{ width: "100%" }}
              />
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <label htmlFor="grant-ends" style={{ display: "block", marginBottom: "0.25rem" }}>
                {t("grant.endsAtLabel")}
              </label>
              <input
                id="grant-ends"
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="kin-input"
                style={{ width: "100%" }}
              />
            </div>

            <button
              type="submit"
              disabled={feedback.kind === "loading"}
              className="kin-btn kin-btn--primary"
            >
              {feedback.kind === "loading" ? t("grant.submitting") : t("grant.submit")}
            </button>
          </form>
        </div>
      )}

      {feedback.kind === "saved" && (
        <p style={{ color: "green" }}>
          {t(feedback.action === "revoke" ? "revoke.success" : "grant.success")}
        </p>
      )}
      {feedback.kind === "error" && <p style={{ color: "red" }}>{feedback.message}</p>}
    </div>
  );
}
