"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { WeightEntryDTO } from "@kinora/contracts";
import { createWeightEntryAction } from "./weight-entry-actions";

export interface WeightEntryFormProps {
  /** Entries loaded server-side by the page, newest `recordedAt` first. */
  initialEntries: WeightEntryDTO[];
}

type Status = "idle" | "saving" | "error";

/**
 * WeightEntryForm — client component for the bodyweight series on the
 * /profile page (17c-profile-body-metrics, PR 2).
 *
 * Renders a weight input (kg), an optional date input, and a read-only
 * reverse-chronological list. Submits invoke `createWeightEntryAction`
 * (which proxies `POST /weight-entries` server-to-server); on success the
 * new entry is prepended locally — no page reload, no re-fetch — and on a
 * validation error the message surfaces inline via `role="alert"`.
 *
 * Deliberately does NOT render the first-entry volume-shift notice — that
 * ships in PR 4, gated on the volume-threading work it explains.
 */
export function WeightEntryForm({ initialEntries }: WeightEntryFormProps) {
  const t = useTranslations();

  const [entries, setEntries] = useState<WeightEntryDTO[]>(initialEntries);
  const [weightKg, setWeightKg] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "saving") return;

    const parsedWeight = Number(weightKg);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      setStatus("error");
      setErrorKey("profile.weightEntry.invalidWeight");
      return;
    }

    setStatus("saving");
    const result = await createWeightEntryAction(
      parsedWeight,
      date.trim() === "" ? undefined : date,
    );

    if (result.kind === "ok") {
      setEntries((current) =>
        [result.entry, ...current].sort(
          (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
        ),
      );
      setWeightKg("");
      setDate("");
      setStatus("idle");
      setErrorKey(null);
    } else {
      setStatus("error");
      setErrorKey(
        result.kind === "validation_error" && result.message === "invalid_recorded_at"
          ? "profile.weightEntry.invalidDate"
          : result.kind === "validation_error" && result.message === "invalid_weight_kg"
            ? "profile.weightEntry.invalidWeight"
            : "profile.weightEntry.error",
      );
    }
  }

  return (
    <div className="kin-card" style={{ maxWidth: 480, marginTop: "1.5rem" }}>
      <h2 className="kin-title" style={{ fontSize: "1.125rem", marginBottom: "1rem" }}>
        {t("profile.weightEntry.heading")}
      </h2>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "1rem" }}>
          <label
            htmlFor="weight-entry-kg"
            style={{ display: "block", marginBottom: "0.25rem" }}
          >
            {t("profile.weightEntry.weightLabel")}
          </label>
          <input
            id="weight-entry-kg"
            type="number"
            value={weightKg}
            placeholder={t("profile.weightEntry.weightPlaceholder")}
            onChange={(e) => {
              setWeightKg(e.target.value);
              setStatus("idle");
              setErrorKey(null);
            }}
            className="kin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ marginBottom: "1.25rem" }}>
          <label
            htmlFor="weight-entry-date"
            style={{ display: "block", marginBottom: "0.25rem" }}
          >
            {t("profile.weightEntry.dateLabel")}
          </label>
          <input
            id="weight-entry-date"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setStatus("idle");
              setErrorKey(null);
            }}
            className="kin-input"
            style={{ width: "100%" }}
          />
        </div>

        <button
          type="submit"
          disabled={status === "saving"}
          className="kin-btn kin-btn--primary"
        >
          {status === "saving" ? t("profile.weightEntry.saving") : t("profile.weightEntry.submit")}
        </button>

        {status === "error" && errorKey ? (
          <p
            role="alert"
            style={{ marginTop: "0.75rem", color: "var(--danger, red)" }}
          >
            {t(errorKey)}
          </p>
        ) : null}
      </form>

      <h3 className="kin-title" style={{ fontSize: "1rem", marginTop: "1.5rem", marginBottom: "0.5rem" }}>
        {t("profile.weightEntry.listHeading")}
      </h3>

      {entries.length === 0 ? (
        <p className="kin-text kin-muted">{t("profile.weightEntry.listEmpty")}</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {entries.map((entry) => (
            <li
              key={entry.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.5rem 0",
                borderBottom: "1px solid var(--border, #eee)",
              }}
            >
              <span>{new Date(entry.recordedAt).toLocaleDateString()}</span>
              <span>{entry.weightKg} kg</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
