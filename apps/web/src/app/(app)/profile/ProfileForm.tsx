"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanGoal, ExperienceLevel, UserProfile } from "@kinora/contracts";
import { saveProfileAction } from "./actions";
import {
  GOAL_SELECT_OPTIONS,
  EXPERIENCE_SELECT_OPTIONS,
} from "./options";

export interface ProfileFormProps {
  /** Profile loaded server-side by the page; `null` when the fetch failed. */
  initialProfile: UserProfile | null;
  /** API error code from a failed server-side load, if any. */
  initialError?: string | null;
}

type Status = "idle" | "saving" | "saved" | "error";

/**
 * ProfileForm — client component for the /profile page.
 *
 * Renders editable Name (text), Goal (select), and Experience level (select)
 * fields. The page server-fetches `GET /user-profile` and seeds the form with
 * the result; submits invoke the `saveProfileAction` server action (which
 * proxies `PUT /user-profile` server-to-server). The browser never holds the
 * session token.
 *
 * Matches the `AiConfigForm` pattern (`kin-card` + `kin-input` + `kin-btn`)
 * and the app's design-system classes. UI copy comes from the
 * `profile.form.*` and `profile.experience.*` catalog keys; goal option
 * labels reuse the existing `wizard.goal.*.label` keys.
 */
export function ProfileForm({ initialProfile, initialError }: ProfileFormProps) {
  const t = useTranslations();

  const [name, setName] = useState<string>(initialProfile?.name ?? "");
  const [goal, setGoal] = useState<PlanGoal | null>(
    initialProfile?.goal ?? null,
  );
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | null>(
    initialProfile?.experienceLevel ?? null,
  );
  const [status, setStatus] = useState<Status>("idle");

  const trimmedName = name.trim();
  const nameBlank = trimmedName.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (nameBlank || status === "saving") return;

    setStatus("saving");
    const result = await saveProfileAction(trimmedName, goal, experienceLevel);

    if (result.kind === "ok") {
      // Reflect the server-normalized values back into the form.
      setName(result.profile.name);
      setGoal(result.profile.goal);
      setExperienceLevel(result.profile.experienceLevel);
      setStatus("saved");
    } else {
      setStatus("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="kin-card" style={{ maxWidth: 480 }}>
      <h2 className="kin-title" style={{ fontSize: "1.125rem", marginBottom: "1rem" }}>
        {t("profile.form.heading")}
      </h2>

      {initialError ? (
        <p
          role="alert"
          className="kin-text"
          style={{ marginBottom: "1rem", color: "var(--danger, red)" }}
        >
          {t("profile.form.loadError")}
        </p>
      ) : null}

      {/* Name — required, non-blank (validated at the edge and in the API). */}
      <div style={{ marginBottom: "1rem" }}>
        <label
          htmlFor="profile-name"
          style={{ display: "block", marginBottom: "0.25rem" }}
        >
          {t("profile.form.name")}
        </label>
        <input
          id="profile-name"
          type="text"
          value={name}
          placeholder={t("profile.form.namePlaceholder")}
          onChange={(e) => {
            setName(e.target.value);
            setStatus("idle");
          }}
          className="kin-input"
          style={{ width: "100%" }}
        />
        {nameBlank ? (
          <p
            role="alert"
            style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--danger, red)" }}
          >
            {t("profile.form.nameRequired")}
          </p>
        ) : null}
      </div>

      {/* Goal — nullable; "" means "not chosen yet". */}
      <div style={{ marginBottom: "1rem" }}>
        <label
          htmlFor="profile-goal"
          style={{ display: "block", marginBottom: "0.25rem" }}
        >
          {t("profile.form.goal")}
        </label>
        <select
          id="profile-goal"
          value={goal ?? ""}
          onChange={(e) => {
            setGoal((e.target.value || null) as PlanGoal | null);
            setStatus("idle");
          }}
          className="kin-input"
          style={{ width: "100%" }}
        >
          <option value="">{t("profile.form.goalPlaceholder")}</option>
          {GOAL_SELECT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Experience level — nullable; "" means "not chosen yet". */}
      <div style={{ marginBottom: "1.25rem" }}>
        <label
          htmlFor="profile-experience"
          style={{ display: "block", marginBottom: "0.25rem" }}
        >
          {t("profile.form.experience")}
        </label>
        <select
          id="profile-experience"
          value={experienceLevel ?? ""}
          onChange={(e) => {
            setExperienceLevel((e.target.value || null) as ExperienceLevel | null);
            setStatus("idle");
          }}
          className="kin-input"
          style={{ width: "100%" }}
        >
          <option value="">{t("profile.form.experiencePlaceholder")}</option>
          {EXPERIENCE_SELECT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={nameBlank || status === "saving"}
        className="kin-btn kin-btn--primary"
      >
        {status === "saving" ? t("profile.form.saving") : t("profile.form.save")}
      </button>

      {status === "saved" ? (
        <p
          role="status"
          style={{ marginTop: "0.75rem", color: "var(--accent, green)" }}
        >
          {t("profile.form.saved")}
        </p>
      ) : null}

      {status === "error" ? (
        <p
          role="alert"
          style={{ marginTop: "0.75rem", color: "var(--danger, red)" }}
        >
          {t("profile.form.error")}
        </p>
      ) : null}
    </form>
  );
}
