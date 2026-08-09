"use client";

import { useRef, useState } from "react";
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
import styles from "../admin.module.css";

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

  /**
   * Idempotency key for the in-flight grant submit (#313). Held in a ref (not
   * state — it must not trigger re-renders and must survive between a failed
   * attempt and its retry). Generated lazily on the first submit of an attempt
   * and reused if that same submit is retried after an error/timeout, so the
   * API replays the original 201 instead of returning a spurious 409. Cleared
   * on success and whenever a different tenant is selected, so the next grant
   * gets a fresh key.
   */
  const grantKeyRef = useRef<string | null>(null);

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
      grantKeyRef.current = null;
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
    // Generate the key lazily; a retry after an error keeps the same key.
    if (grantKeyRef.current === null) {
      grantKeyRef.current = crypto.randomUUID();
    }
    const result = await grantAction(selected.tenant.id, {
      tier,
      reason: reason.trim(),
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
      operationKey: grantKeyRef.current,
    });
    if (result.kind === "ok") {
      // Fresh key for the next distinct grant.
      grantKeyRef.current = null;
      setFeedback({ kind: "saved", action: "grant" });
      await refreshSelected();
    } else {
      // Keep the key so an immediate retry is treated as the SAME operation.
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
    <div>
      {feedback.kind === "saved" && (
        <p className={`${styles.banner} ${styles.bannerSuccess}`} role="status">
          {t(feedback.action === "revoke" ? "revoke.success" : "grant.success")}
        </p>
      )}
      {feedback.kind === "error" && (
        <p className={`${styles.banner} ${styles.bannerDanger}`} role="alert">
          {feedback.message}
        </p>
      )}

      <div className={styles.provision}>
        {/* Step 1 — find the organization. */}
        <div className={styles.col}>
          <section className={styles.panel} aria-labelledby="tenants-step1">
            <div className={styles.panelHead}>
              <span className={styles.stepBadge} aria-hidden="true">
                1
              </span>
              <h2 id="tenants-step1">{t("searchTitle")}</h2>
            </div>

            <form onSubmit={handleSearch} className={styles.panelBody}>
              <div className={styles.field}>
                <label htmlFor="tenant-search">{t("search.label")}</label>
                <input
                  id="tenant-search"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="kin-input"
                  placeholder={t("search.placeholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className={styles.hint}>{t("searchHint")}</p>
              </div>
              <div className={styles.formFoot}>
                <button type="submit" disabled={searching} className="kin-btn kin-btn--primary">
                  {searching ? t("search.searching") : t("search.button")}
                </button>
              </div>
            </form>

            {results === null ? (
              <div className={`${styles.state} ${styles.stateCompact}`} data-testid="tenants-search-idle">
                <div className={styles.eyebrow}>{t("searchTitle")}</div>
                <h2>{t("idleTitle")}</h2>
                <p>{t("idleDescription")}</p>
              </div>
            ) : results.length === 0 ? (
              <div className={`${styles.state} ${styles.stateCompact} ${styles.stateEmpty}`}>
                <div className={styles.eyebrow}>{t("noResultsTitle")}</div>
                <p>{t("search.noResults")}</p>
              </div>
            ) : (
              <ul className={styles.results}>
                {results.map((tenant) => {
                  const isSelected = selected?.tenant.id === tenant.id;
                  return (
                    <li key={tenant.id}>
                      <button
                        type="button"
                        className={`${styles.result}${isSelected ? ` ${styles.resultSelected}` : ""}`}
                        aria-current={isSelected ? "true" : undefined}
                        onClick={() => handleSelect(tenant.id)}
                      >
                        <span className={styles.resultName}>{tenant.name}</span>
                        <span className={styles.resultId}>{tenant.id}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Steps 2 and 3 — read the current state, then change it. */}
        <div className={styles.col}>
          {!selected ? (
            <section className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.stepBadge} aria-hidden="true">
                  2
                </span>
                <h2>{t("detailTitle")}</h2>
              </div>
              <div className={`${styles.state} ${styles.stateCompact}`} data-testid="tenants-no-selection">
                <h2>{t("noSelectionTitle")}</h2>
                <p>{t("noSelectionDescription")}</p>
              </div>
            </section>
          ) : (
            <>
              <section className={styles.panel} aria-labelledby="tenants-step2">
                <div className={styles.panelHead}>
                  <span className={styles.stepBadge} aria-hidden="true">
                    2
                  </span>
                  <h2 id="tenants-step2">{t("detailTitle")}</h2>
                </div>
                <div className={styles.panelBody}>
                  <div className={styles.orgName}>{selected.tenant.name}</div>
                  <div className={styles.orgId}>{selected.tenant.id}</div>

                  <div className={styles.facts}>
                    <div className={styles.metric}>
                      <div className={styles.eyebrow}>{t("state.effectiveTier")}</div>
                      <div className={`${styles.metricValue} ${styles.metricValueSm}`}>
                        {selected.effectiveTier}
                      </div>
                    </div>
                    <div
                      className={`${styles.metric}${selected.billingStatus ? "" : ` ${styles.metricAbsent}`}`}
                    >
                      <div className={styles.eyebrow}>{t("state.billingStatus")}</div>
                      <div className={`${styles.metricValue} ${styles.metricValueSm}`}>
                        {selected.billingStatus ?? t("state.none")}
                      </div>
                    </div>
                    <div
                      className={`${styles.metric} ${
                        selected.activeOverride ? styles.metricOverrideOn : styles.metricAbsent
                      }`}
                    >
                      <div className={styles.eyebrow}>{t("state.activeOverride")}</div>
                      <div className={`${styles.metricValue} ${styles.metricValueSm}`}>
                        {selected.activeOverride ? selected.activeOverride.tier : t("state.none")}
                      </div>
                      {!selected.activeOverride && (
                        <div className={styles.metricSub}>{t("state.noOverride")}</div>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className={styles.panel} aria-labelledby="tenants-step3">
                <div className={styles.panelHead}>
                  <span className={styles.stepBadge} aria-hidden="true">
                    3
                  </span>
                  <h2 id="tenants-step3">{t("grant.title")}</h2>
                </div>
                <form onSubmit={handleGrant} className={styles.panelBody}>
                  <div className={styles.grantGrid}>
                    <div className={styles.field}>
                      <label htmlFor="grant-tier">{t("grant.tierLabel")}</label>
                      <select
                        id="grant-tier"
                        value={tier}
                        onChange={(e) => setTier(e.target.value as GrantableTier)}
                        className="kin-input"
                      >
                        {GRANTABLE_TIERS.map((value) => (
                          <option key={value} value={value}>
                            {value === "trainer" ? t("grant.tierTrainer") : t("grant.tierGym")}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.field}>
                      <label htmlFor="grant-starts">{t("grant.startsAtLabel")}</label>
                      <input
                        id="grant-starts"
                        type="date"
                        value={startsAt}
                        onChange={(e) => setStartsAt(e.target.value)}
                        className={`kin-input ${styles.dateInput}`}
                      />
                    </div>

                    <div className={`${styles.field} ${styles.span2}`}>
                      {/* The "Required" marker sits OUTSIDE the label: anything
                          inside it joins the textarea's accessible name. */}
                      <label htmlFor="grant-reason">{t("grant.reasonLabel")}</label>
                      <textarea
                        id="grant-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className={`kin-input ${styles.textarea}`}
                        rows={3}
                        placeholder={t("grant.reasonPlaceholder")}
                        required
                      />
                      <p className={styles.hint}>
                        <span className={styles.required}>{t("required")}</span> {t("reasonHint")}
                      </p>
                    </div>

                    <div className={styles.field}>
                      <label htmlFor="grant-ends">{t("grant.endsAtLabel")}</label>
                      <input
                        id="grant-ends"
                        type="date"
                        value={endsAt}
                        onChange={(e) => setEndsAt(e.target.value)}
                        className={`kin-input ${styles.dateInput}`}
                      />
                    </div>
                  </div>

                  <div className={styles.formFoot}>
                    <button
                      type="submit"
                      disabled={feedback.kind === "loading"}
                      className="kin-btn kin-btn--primary"
                    >
                      {feedback.kind === "loading" ? t("grant.submitting") : t("grant.submit")}
                    </button>
                    <span className={styles.note}>{t("grantNote")}</span>
                  </div>
                </form>
              </section>

              {/* Only rendered when there is something to revoke. */}
              {selected.activeOverride && (
                <section
                  className={`${styles.panel} ${styles.dangerZone}`}
                  aria-labelledby="tenants-revoke"
                >
                  <div className={styles.panelHead}>
                    <h2 id="tenants-revoke">{t("revokeTitle")}</h2>
                  </div>
                  <div className={styles.panelBody}>
                    <div className={styles.dangerRow}>
                      <p>{t("revokeDescription")}</p>
                      <button
                        type="button"
                        className="kin-btn kin-btn--danger"
                        onClick={handleRevoke}
                        disabled={feedback.kind === "loading"}
                      >
                        {t("revoke.button")}
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
