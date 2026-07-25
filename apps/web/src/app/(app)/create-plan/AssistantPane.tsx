"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PlanSpecDraftSchema, type PlanGoal, type TrainingLocation } from "@kinora/contracts";
import { parseSSEStream } from "./chat-stream";
import type { ChatDraftSpec } from "./chat-types";
import styles from "./assistant-pane.module.css";

/** Same-origin proxy route that injects the Bearer token and streams SSE back. */
const CHAT_ENDPOINT = "/create-plan/chat";

interface ChatMessage {
  role: "assistant" | "user";
  text: string;
}

export interface AssistantPaneProps {
  /** Shared plan draft (the SAME `plan_drafts` the Formulario wizard uses). */
  spec: ChatDraftSpec;
  /** Update the shared draft in memory (terminal `draft` event + panel edits). */
  onSpecChange: (spec: ChatDraftSpec) => void;
  /** Persist a panel edit to the shared server draft (POST /plan-specs/drafts). */
  persistSpec: (spec: ChatDraftSpec) => Promise<void>;
  /** Promote → confirm → generate via the EXISTING wizard path, then navigate. */
  onGenerate: () => Promise<void>;
  /** Read-only "Nivel" prefill from the user profile (never written by chat). */
  experienceLevel?: string | null;
}

const GOAL_LABEL_KEY: Record<PlanGoal, string> = {
  strength: "wizard.goal.strength.label",
  hypertrophy: "wizard.goal.hypertrophy.label",
  fat_loss: "wizard.goal.fatLoss.label",
  general_fitness: "wizard.goal.generalFitness.label",
};

const LOCATION_LABEL_KEY: Record<TrainingLocation, string> = {
  home: "wizard.location.home.label",
  gym: "wizard.location.gym.label",
  outdoor: "wizard.location.outdoor.label",
};

const GOALS: readonly PlanGoal[] = ["strength", "hypertrophy", "fat_loss", "general_fitness"];
const LOCATIONS: readonly TrainingLocation[] = ["home", "gym", "outdoor"];

/**
 * Complete AND valid: every required field is present, and re-validates the
 * whole spec against `PlanSpecDraftSchema.safeParse` (the SAME contract the
 * server confirm gate uses) so an out-of-range panel edit (e.g. daysPerWeek=0,
 * sessionDurationMinutes outside 15-240, an invalid enum) keeps "Generar plan"
 * disabled instead of only failing at the server. The server confirm remains
 * the real enforcement — this is a UX gate, not a replacement for it.
 */
function isSpecComplete(spec: ChatDraftSpec): boolean {
  const hasAllFields =
    spec.goal != null &&
    spec.location != null &&
    spec.daysPerWeek != null &&
    spec.sessionDurationMinutes != null &&
    spec.equipment != null &&
    spec.limitations != null;
  if (!hasAllFields) return false;
  return PlanSpecDraftSchema.safeParse(spec).success;
}

/**
 * Asistente chat pane (12 Slice 3, OD MODE A). Left: the streamed conversation.
 * Right: the "Datos extraídos" review/edit panel + "Generar plan".
 *
 * Transport: a turn POSTs the message to the same-origin `/create-plan/chat`
 * proxy (which attaches the `kinora_session` Bearer server-side) and reads the
 * `text/event-stream` body via `fetch` + `ReadableStream` — NOT `EventSource`,
 * which cannot POST nor set an `Authorization` header. Prose renders
 * incrementally from `token` frames; the terminal `draft` event updates the
 * shared draft; a terminal `error` shows a retry affordance with the prior
 * draft intact.
 *
 * Turn serialization (the S2b lost-update mitigation): a new turn cannot start
 * while one is in flight — the send control is disabled and `sendTurn` bails
 * when `streaming`. An `AbortController` is aborted on unmount/navigation so an
 * in-flight stream never writes into an unmounted tree.
 */
export function AssistantPane({
  spec,
  onSpecChange,
  persistSpec,
  onGenerate,
  experienceLevel,
}: AssistantPaneProps) {
  const t = useTranslations();
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: t("chat.greeting") },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState(false);
  const [generating, setGenerating] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const lastUserMessageRef = useRef<string>("");

  // Abort any in-flight stream on unmount/navigation so no token write lands in
  // an unmounted tree and the upstream API sees the disconnect.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /**
   * Run one turn. `appendUserMessage` is false on retry: the ORIGINAL user
   * bubble is reused (not re-sent to the thread) so an error + retry reads
   * naturally — one user message, one assistant reply — instead of showing a
   * duplicated user bubble. A fresh, empty assistant placeholder is always
   * appended to receive the incoming tokens/terminal text.
   */
  const runTurn = useCallback(
    async (message: string, appendUserMessage: boolean) => {
      // Turn serialization: never overlap turns (prevents the shared-draft
      // lost-update from two concurrent commits).
      if (streaming) return;

      lastUserMessageRef.current = message;
      setErrorReason(null);
      setMessages((prev) => {
        const withUser = appendUserMessage
          ? [...prev, { role: "user" as const, text: message }]
          : prev;
        return [...withUser, { role: "assistant" as const, text: "" }];
      });
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(CHAT_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          setMessages((prev) => removeTrailingEmptyAssistant(prev));
          setErrorReason("generic");
          return;
        }

        for await (const event of parseSSEStream(res.body)) {
          if (event.type === "token") {
            setMessages((prev) => appendToAssistant(prev, event.delta));
          } else if (event.type === "draft") {
            if (event.assistantMessage) {
              setMessages((prev) => replaceAssistant(prev, event.assistantMessage));
            }
            onSpecChange(event.draftSpec);
          } else {
            // Terminal error: never leave a blank coach bubble in the thread —
            // remove the placeholder if no prose arrived before the failure;
            // keep it (as partial prose) when some tokens already streamed.
            setMessages((prev) => removeTrailingEmptyAssistant(prev));
            setErrorReason(event.reason);
          }
        }
      } catch {
        // A user-initiated abort (unmount/navigation) is expected; only surface
        // a real failure when the turn was not aborted.
        if (!controller.signal.aborted) {
          setMessages((prev) => removeTrailingEmptyAssistant(prev));
          setErrorReason("generic");
        }
      } finally {
        setStreaming(false);
      }
    },
    [streaming, onSpecChange],
  );

  const handleSend = () => {
    const message = input.trim();
    if (message === "" || streaming) return;
    setInput("");
    void runTurn(message, true);
  };

  const handleRetry = () => {
    // Resend the SAME last turn — do not append another user bubble.
    if (lastUserMessageRef.current !== "") void runTurn(lastUserMessageRef.current, false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const editField = (patch: Partial<ChatDraftSpec>) => {
    const next = { ...spec, ...patch };
    onSpecChange(next);
    void persistSpec(next);
  };

  const handleGenerate = async () => {
    setGenerateError(false);
    setGenerating(true);
    try {
      await onGenerate();
    } catch {
      setGenerateError(true);
    } finally {
      setGenerating(false);
    }
  };

  const errorMessage = errorReason
    ? resolveErrorMessage(t, errorReason)
    : null;

  return (
    <div className={styles.layout}>
      {/* Chat thread */}
      <section className={styles.chatCol} aria-label={t("chat.threadAria")}>
        <header className={styles.coach}>
          <div className={styles.coachName}>{t("chat.coachName")}</div>
          <div className={styles.coachStatus}>{t("chat.coachStatus")}</div>
        </header>

        <div className={styles.messages}>
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? styles.msgUser : styles.msgAi}
              data-role={m.role}
            >
              <div className={styles.bubble}>{m.text}</div>
            </div>
          ))}
          {streaming && (
            <p className={styles.streamingHint} aria-live="polite">
              {t("chat.streaming")}
            </p>
          )}
        </div>

        {errorMessage && (
          <div className={styles.error} role="alert">
            <span>{errorMessage}</span>
            <button type="button" className="kin-btn" onClick={handleRetry}>
              {t("chat.retry")}
            </button>
          </div>
        )}

        <div className={styles.inputRow}>
          <textarea
            className="kin-input"
            aria-label={t("chat.inputAria")}
            placeholder={t("chat.inputPlaceholder")}
            rows={1}
            value={input}
            disabled={streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="kin-btn kin-btn--primary"
            aria-label={t("chat.sendAria")}
            disabled={streaming || input.trim() === ""}
            onClick={handleSend}
          >
            {t("chat.send")}
          </button>
        </div>
      </section>

      {/* Datos extraídos panel */}
      <aside className={styles.dataCol}>
        <div className="kin-card">
          <h2 className={styles.panelTitle}>{t("chat.panel.title")}</h2>

          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="chat-field-goal">
                {t("chat.field.goal")}
              </label>
              <select
                id="chat-field-goal"
                className="kin-input"
                value={spec.goal ?? ""}
                aria-label={t("chat.panel.editAria", { field: t("chat.field.goal") })}
                onChange={(e) =>
                  editField({ goal: (e.target.value || undefined) as PlanGoal | undefined })
                }
              >
                <option value="">{t("chat.panel.notSet")}</option>
                {GOALS.map((g) => (
                  <option key={g} value={g}>
                    {t(GOAL_LABEL_KEY[g])}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="chat-field-location">
                {t("chat.field.location")}
              </label>
              <select
                id="chat-field-location"
                className="kin-input"
                value={spec.location ?? ""}
                aria-label={t("chat.panel.editAria", { field: t("chat.field.location") })}
                onChange={(e) =>
                  editField({
                    location: (e.target.value || undefined) as TrainingLocation | undefined,
                  })
                }
              >
                <option value="">{t("chat.panel.notSet")}</option>
                {LOCATIONS.map((l) => (
                  <option key={l} value={l}>
                    {t(LOCATION_LABEL_KEY[l])}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="chat-field-days">
                {t("chat.field.daysPerWeek")}
              </label>
              <input
                id="chat-field-days"
                type="number"
                min={1}
                max={7}
                className="kin-input"
                value={spec.daysPerWeek ?? ""}
                aria-label={t("chat.panel.editAria", { field: t("chat.field.daysPerWeek") })}
                onChange={(e) =>
                  editField({
                    daysPerWeek: e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="chat-field-duration">
                {t("chat.field.sessionDuration")}
              </label>
              <input
                id="chat-field-duration"
                type="number"
                min={15}
                max={240}
                className="kin-input"
                value={spec.sessionDurationMinutes ?? ""}
                aria-label={t("chat.panel.editAria", {
                  field: t("chat.field.sessionDuration"),
                })}
                onChange={(e) =>
                  editField({
                    sessionDurationMinutes:
                      e.target.value === "" ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t("chat.field.equipment")}</span>
              <span className={styles.fieldValue}>
                {spec.equipment == null
                  ? t("chat.panel.notSet")
                  : t("chat.value.equipmentCount", { n: spec.equipment.length })}
              </span>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t("chat.field.limitations")}</span>
              <span className={styles.fieldValue}>
                {spec.limitations == null
                  ? t("chat.panel.notSet")
                  : t("chat.value.limitationsCount", { n: spec.limitations.length })}
              </span>
            </div>

            {experienceLevel && (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>{t("chat.field.level")}</span>
                <span className={styles.fieldValue}>{experienceLevel}</span>
              </div>
            )}
          </div>

          {generateError && (
            <p className="kin-text" role="alert" style={{ color: "var(--danger, red)" }}>
              {t("chat.panel.generateError")}
            </p>
          )}

          <button
            type="button"
            className={`kin-btn kin-btn--primary ${styles.generate}`}
            disabled={!isSpecComplete(spec) || generating}
            onClick={handleGenerate}
          >
            {t("chat.panel.generate")}
          </button>
        </div>
      </aside>
    </div>
  );
}

function appendToAssistant(messages: ChatMessage[], delta: string): ChatMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i]!.role === "assistant") {
      next[i] = { role: "assistant", text: next[i]!.text + delta };
      return next;
    }
  }
  return next;
}

/**
 * Drop the trailing assistant placeholder when it is still empty (no prose
 * arrived before a terminal error/failure) so the thread never renders a
 * blank coach bubble. A placeholder that already received partial prose is
 * left in place as the (incomplete) reply.
 */
function removeTrailingEmptyAssistant(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && last.text === "") {
    return messages.slice(0, -1);
  }
  return messages;
}

function replaceAssistant(messages: ChatMessage[], text: string): ChatMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i]!.role === "assistant") {
      next[i] = { role: "assistant", text };
      return next;
    }
  }
  return next;
}

function resolveErrorMessage(t: ReturnType<typeof useTranslations>, reason: string): string {
  if (reason === "chat_stream_timeout") return t("chat.error.chat_stream_timeout");
  if (reason === "chat_stream_failed") return t("chat.error.chat_stream_failed");
  return t("chat.error.generic");
}
