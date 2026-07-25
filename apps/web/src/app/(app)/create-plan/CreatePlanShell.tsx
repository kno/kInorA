"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { UserPreferences, UserProfile } from "@kinora/contracts";
import { AssistantPane } from "./AssistantPane";
import { StepperShell, type DraftSpec, type InitialDraft } from "./StepperShell";
import type { ChatDraftSpec } from "./chat-types";
import styles from "./create-plan-shell.module.css";

export type CreateMode = "asistente" | "formulario";

export interface CreatePlanShellProps {
  /** Server-derived default mode: Asistente for Pro, Formulario for Free. */
  defaultMode: CreateMode;
  /** Effective tier === "pro", resolved server-side (never trusted from the client). */
  isPro: boolean;
  /** Where the Free upgrade CTA points (reuses 11b billing `#pro-card`). */
  upgradePath: string;
  initialDraft?: InitialDraft;
  initialProfile?: UserProfile | null;
  initialPreferences?: UserPreferences | null;
  saveDraftAction: (step: number, spec: DraftSpec) => Promise<void>;
  saveUserPreferencesAction?: (input: {
    defaultLocation?: string | null;
    defaultDuration?: number | null;
    defaultEquipment?: string[] | null;
  }) => Promise<void>;
  confirmPlanSpecAction: () => Promise<{ planId: string; status: string }>;
}

/**
 * Create-plan shell (12 Slice 3, OD MODE toggle). Chooses the default mode from
 * the SERVER-derived tier (Asistente for Pro, Formulario for Free) and lets the
 * user switch between the two — both operate over the SAME shared plan draft.
 *
 * A Free tenant never gets a working chat: the Asistente tab shows a teaser + a
 * "Mejora a Pro" CTA. The client default is cosmetic; the real enforcement is
 * the server's 403 Pro gate on `POST /plan-specs/chat`.
 */
export function CreatePlanShell({
  defaultMode,
  isPro,
  upgradePath,
  initialDraft,
  initialProfile,
  initialPreferences,
  saveDraftAction,
  saveUserPreferencesAction,
  confirmPlanSpecAction,
}: CreatePlanShellProps) {
  const t = useTranslations();
  const router = useRouter();
  const [mode, setMode] = useState<CreateMode>(defaultMode);

  // Shared draft: chat's terminal `draft` event and panel edits both flow here,
  // and the Formulario wizard re-seeds from it on switch (mode toggle preserves
  // the in-progress spec — spec: "Shared Plan Draft Across Modes").
  const [spec, setSpec] = useState<DraftSpec>(initialDraft?.spec ?? {});
  const step = initialDraft?.step ?? 1;
  // Remount the wizard when entering Formulario so it hydrates from the latest
  // shared spec (including fields the chat just set).
  const [stepperKey, setStepperKey] = useState(0);

  const switchMode = (next: CreateMode) => {
    if (next === "formulario") setStepperKey((k) => k + 1);
    setMode(next);
  };

  // Wrap the wizard's save so wizard-driven changes also update the shared spec
  // the Asistente panel reads.
  const saveDraftShared = async (nextStep: number, nextSpec: DraftSpec) => {
    setSpec(nextSpec);
    await saveDraftAction(nextStep, nextSpec);
  };

  const persistSpec = async (next: ChatDraftSpec) => {
    await saveDraftAction(step, next as DraftSpec);
  };

  const handleGenerate = async () => {
    const { planId } = await confirmPlanSpecAction();
    router.push(`/plan/${planId}`);
  };

  return (
    <main className="kin-page">
      <header className={styles.topbar}>
        <h1 className={styles.title}>{t("wizard.step.goalTitle")}</h1>
        <div className={styles.toggle} role="group" aria-label={t("chat.mode.toggleAria")}>
          <button
            type="button"
            id="btn-asistente"
            className={mode === "asistente" ? styles.tabActive : styles.tab}
            aria-pressed={mode === "asistente"}
            onClick={() => switchMode("asistente")}
          >
            {t("chat.mode.assistant")}
          </button>
          <button
            type="button"
            id="btn-formulario"
            className={mode === "formulario" ? styles.tabActive : styles.tab}
            aria-pressed={mode === "formulario"}
            onClick={() => switchMode("formulario")}
          >
            {t("chat.mode.formulario")}
          </button>
        </div>
      </header>

      {mode === "asistente" ? (
        isPro ? (
          <AssistantPane
            spec={spec}
            onSpecChange={(next) => setSpec(next as DraftSpec)}
            persistSpec={persistSpec}
            onGenerate={handleGenerate}
            experienceLevel={initialProfile?.experienceLevel ?? null}
          />
        ) : (
          <FreeTeaser upgradePath={upgradePath} />
        )
      ) : (
        <StepperShell
          key={stepperKey}
          initialDraft={{ step, spec }}
          initialProfile={initialProfile}
          initialPreferences={initialPreferences}
          saveDraftAction={saveDraftShared}
          saveUserPreferencesAction={saveUserPreferencesAction}
          confirmPlanSpecAction={confirmPlanSpecAction}
        />
      )}
    </main>
  );
}

/**
 * Free Asistente teaser + upgrade CTA. Free tenants get the Formulario as the
 * working flow; this pane advertises the Pro-only Asistente and links to the
 * billing `#pro-card` (reusing the 11b upgrade convention).
 */
function FreeTeaser({ upgradePath }: { upgradePath: string }) {
  const t = useTranslations();
  return (
    <section id="pro-card" className={`kin-card ${styles.teaser}`}>
      <span className={styles.teaserEyebrow}>{t("chat.teaser.eyebrow")}</span>
      <h2 className={styles.teaserTitle}>{t("chat.teaser.title")}</h2>
      <p className="kin-text">{t("chat.teaser.description")}</p>
      <a className="kin-btn kin-btn--primary" href={upgradePath}>
        {t("chat.teaser.cta")}
      </a>
    </section>
  );
}
