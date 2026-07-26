/**
 * RN create-plan Asistente screen (item-13 C2b) — the mobile text-chat
 * equivalent of the web `AssistantPane` (`apps/web/.../create-plan/AssistantPane.tsx`).
 *
 * This is thin React-Native glue over the headless C2a turn-lifecycle store
 * (`chat-store.ts`) and the C1 plan-draft client (`plan-draft-client.ts`); all
 * turn/serialization/abort/session-expiry logic lives in those tested modules.
 * The screen only renders their state and forwards user intent:
 *   - the message thread (user/assistant bubbles, streaming assistant prose);
 *   - a text input + send that calls `store.runTurn(text)`, disabled while a
 *     turn streams (the S2b serialization mitigation, enforced in the store);
 *   - an error state with a retry affordance (`store.retry()`);
 *   - the terminal-draft "Datos extraídos" panel with editable enum/number
 *     fields (goal, location, days/week, session length) and read-only
 *     equipment/limitations counts, matching the web panel's edit scope;
 *   - a "Generar plan" action gated on a schema-valid spec that flows through
 *     the C1 client (`promoteDraft` → `confirmPlan`), the EXISTING generate path.
 *
 * ONE store is created per screen instance and disposed on unmount so an
 * in-flight XHR is aborted and no late stream callback mutates a torn-down
 * store. A `401`/missing-token turn surfaces `onSessionExpired`, which clears
 * the stored token and resets navigation to Login — mirroring
 * `WorkoutTrackerScreen`'s `handleUnauthenticatedSession`.
 *
 * Pro-gating: the API `403`s the chat endpoint for Free tenants; the screen has
 * no local tier signal (mobile has no billing surface yet), so enforcement is
 * the API 403, surfaced here as a chat error state — the same fail-closed
 * boundary the web relies on server-side.
 *
 * INFRA GAP (documented, not faked): mobile has no plan-status/plan-list screen
 * yet (see `HomeScreen.tsx`), so a successful generation navigates back to Home
 * rather than a plan-progress view. When a mobile plan surface exists, the
 * post-generate destination is swapped for it.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useIntl } from "react-intl";
import {
  PlanSpecDraftSchema,
  type PlanGoal,
  type TrainingLocation,
} from "@kinora/contracts";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { deleteSessionToken } from "../../auth/session-storage";
import {
  saveDraft as defaultSaveDraft,
  promoteDraft as defaultPromoteDraft,
  confirmPlan as defaultConfirmPlan,
  type SaveDraftResult,
  type PromoteResult,
  type ConfirmResult,
  type ClientOptions,
} from "../../api/plan-draft-client";
import {
  createChatStore,
  type ChatStore,
  type ChatStreamFn,
} from "./chat-store";
import type { ChatDraftSpec } from "./chat-types";
import { styles } from "./AssistantScreen.styles";

const GOALS: readonly PlanGoal[] = ["strength", "hypertrophy", "fat_loss", "general_fitness"];
const LOCATIONS: readonly TrainingLocation[] = ["home", "gym", "outdoor"];

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

/** The three C1 client calls the screen depends on — injectable for tests. */
interface PlanDraftClientApi {
  saveDraft: (step: number, spec: ChatDraftSpec, options?: ClientOptions) => Promise<SaveDraftResult>;
  promoteDraft: (options?: ClientOptions) => Promise<PromoteResult>;
  confirmPlan: (specId: string, options?: ClientOptions) => Promise<ConfirmResult>;
}

export interface AssistantScreenProps {
  navigation: NativeStackNavigationProp<any>;
  /** Stream implementation — defaults to `runChatStream`; overridden in tests. */
  stream?: ChatStreamFn;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
  /** Seed the shared draft (e.g. a server-loaded current draft). */
  initialSpec?: ChatDraftSpec;
  /** Plan-draft client — defaults to the real C1 module; injected in tests. */
  client?: Partial<PlanDraftClientApi>;
  /** Clear the stored session on expiry — defaults to `deleteSessionToken`. */
  clearSession?: () => Promise<void>;
}

/**
 * Complete AND schema-valid: every required field present and the whole spec
 * re-validates against `PlanSpecDraftSchema` (the SAME contract the server
 * confirm gate uses), so an out-of-range edit (days=0, duration outside 15-240)
 * keeps "Generar plan" disabled instead of only failing at the server. The
 * server confirm stays the real enforcement — this is a UX gate.
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

export default function AssistantScreen({
  navigation,
  stream,
  apiBaseUrl,
  getToken,
  initialSpec,
  client,
  clearSession,
}: AssistantScreenProps) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, unknown>) =>
    intl.formatMessage({ id }, values as never);

  // Stable helpers captured once by the store — navigation/clearSession refs
  // are stable across renders, so the store's single `onSessionExpired` closure
  // stays correct without re-creating the store.
  const clearSessionRef = useRef(clearSession ?? deleteSessionToken);
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const clientRef = useRef<PlanDraftClientApi>({
    saveDraft: client?.saveDraft ?? defaultSaveDraft,
    promoteDraft: client?.promoteDraft ?? defaultPromoteDraft,
    confirmPlan: client?.confirmPlan ?? defaultConfirmPlan,
  });
  clientRef.current = {
    saveDraft: client?.saveDraft ?? defaultSaveDraft,
    promoteDraft: client?.promoteDraft ?? defaultPromoteDraft,
    confirmPlan: client?.confirmPlan ?? defaultConfirmPlan,
  };

  const routeToLogin = () => {
    void clearSessionRef.current().finally(() => {
      navigationRef.current.reset({ index: 0, routes: [{ name: "Login" }] });
    });
  };

  // ONE store per screen instance (guarded lazy init — `useRef` has no lazy
  // initializer, so create it on first render only).
  const storeRef = useRef<ChatStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createChatStore({
      greeting: t("chat.greeting"),
      initialSpec,
      stream,
      apiBaseUrl,
      getToken,
      onSessionExpired: routeToLogin,
    });
  }
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getState);

  // Abort the in-flight turn + freeze the store on unmount/navigation so no
  // token write lands in a torn-down tree.
  useEffect(() => () => store.dispose(), [store]);

  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(false);

  const handleSend = async () => {
    const message = input.trim();
    if (message === "" || state.streaming) return;
    setInput("");
    await store.runTurn(message);
  };

  const handleRetry = async () => {
    await store.retry();
  };

  const editField = (patch: Partial<ChatDraftSpec>) => {
    const next = { ...state.spec, ...patch };
    store.setSpec(next);
    // Persist to the shared server draft so the server-authoritative
    // `promoteDraft` reflects panel edits (fire-and-forget, mirrors web's
    // `persistSpec`). Step 1: the create-plan draft has a single logical step
    // in the Asistente flow (web uses `initialDraft?.step ?? 1`).
    void clientRef.current.saveDraft(1, next, { apiBaseUrl, getToken });
  };

  const handleGenerate = async () => {
    setGenerateError(false);
    setGenerating(true);
    try {
      const promoted = await clientRef.current.promoteDraft({ apiBaseUrl, getToken });
      if (promoted.kind !== "ok") {
        if (promoted.sessionExpired) routeToLogin();
        else setGenerateError(true);
        return;
      }
      const confirmed = await clientRef.current.confirmPlan(promoted.id, { apiBaseUrl, getToken });
      if (confirmed.kind !== "ok") {
        if (confirmed.sessionExpired) routeToLogin();
        else setGenerateError(true);
        return;
      }
      // INFRA GAP: no mobile plan-status screen yet — return to Home.
      navigationRef.current.navigate("Home");
    } catch {
      setGenerateError(true);
    } finally {
      setGenerating(false);
    }
  };

  const errorMessage = state.errorReason ? resolveErrorMessage(t, state.errorReason) : null;
  const spec = state.spec;
  const generateDisabled = !isSpecComplete(spec) || generating;

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.coachName}>{t("chat.coachName")}</Text>
        <Text style={styles.coachStatus}>{t("chat.coachStatus")}</Text>

        {/* Chat thread */}
        {state.messages.map((m, i) => (
          <View
            key={i}
            style={m.role === "user" ? styles.bubbleRowUser : styles.bubbleRowAi}
          >
            <View style={m.role === "user" ? styles.bubbleUser : styles.bubbleAi}>
              <Text testID="chat-bubble" style={styles.bubbleText}>
                {m.text}
              </Text>
            </View>
          </View>
        ))}

        {state.streaming && (
          <Text style={styles.streamingHint} accessibilityLiveRegion="polite">
            {t("chat.streaming")}
          </Text>
        )}

        {errorMessage && (
          <View style={styles.errorBox} accessibilityRole="alert" testID="chat-error">
            <Text style={styles.errorText}>{errorMessage}</Text>
            <Pressable
              testID="retry-btn"
              style={styles.btn}
              accessibilityRole="button"
              accessibilityLabel={t("chat.retry")}
              onPress={handleRetry}
            >
              <Text style={styles.btnText}>{t("chat.retry")}</Text>
            </Pressable>
          </View>
        )}

        {/* Datos extraídos panel */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>{t("chat.panel.title")}</Text>

          {/* Goal (enum) */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("chat.field.goal")}</Text>
            <View style={styles.pillRow}>
              {GOALS.map((g) => {
                const selected = spec.goal === g;
                return (
                  <Pressable
                    key={g}
                    testID={`goal-${g}`}
                    style={[styles.pill, selected && styles.pillSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t("chat.panel.editAria", { field: t("chat.field.goal") })}
                    onPress={() => editField({ goal: selected ? undefined : g })}
                  >
                    <Text style={styles.pillText}>{t(GOAL_LABEL_KEY[g])}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Location (enum) */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("chat.field.location")}</Text>
            <View style={styles.pillRow}>
              {LOCATIONS.map((l) => {
                const selected = spec.location === l;
                return (
                  <Pressable
                    key={l}
                    testID={`location-${l}`}
                    style={[styles.pill, selected && styles.pillSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t("chat.panel.editAria", {
                      field: t("chat.field.location"),
                    })}
                    onPress={() => editField({ location: selected ? undefined : l })}
                  >
                    <Text style={styles.pillText}>{t(LOCATION_LABEL_KEY[l])}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Days per week (number) */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("chat.field.daysPerWeek")}</Text>
            <TextInput
              testID="field-days"
              style={styles.numberInput}
              keyboardType="number-pad"
              value={spec.daysPerWeek != null ? String(spec.daysPerWeek) : ""}
              accessibilityLabel={t("chat.panel.editAria", {
                field: t("chat.field.daysPerWeek"),
              })}
              onChangeText={(text) =>
                editField({ daysPerWeek: text === "" ? undefined : Number(text) })
              }
            />
          </View>

          {/* Session length (number) */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("chat.field.sessionDuration")}</Text>
            <TextInput
              testID="field-duration"
              style={styles.numberInput}
              keyboardType="number-pad"
              value={spec.sessionDurationMinutes != null ? String(spec.sessionDurationMinutes) : ""}
              accessibilityLabel={t("chat.panel.editAria", {
                field: t("chat.field.sessionDuration"),
              })}
              onChangeText={(text) =>
                editField({ sessionDurationMinutes: text === "" ? undefined : Number(text) })
              }
            />
          </View>

          {/* Equipment (read-only count — matches web scope) */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("chat.field.equipment")}</Text>
            <Text testID="field-equipment" style={styles.fieldValue}>
              {spec.equipment == null
                ? t("chat.panel.notSet")
                : t("chat.value.equipmentCount", { n: spec.equipment.length })}
            </Text>
          </View>

          {/* Limitations (read-only count — matches web scope) */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("chat.field.limitations")}</Text>
            <Text testID="field-limitations" style={styles.fieldValue}>
              {spec.limitations == null
                ? t("chat.panel.notSet")
                : t("chat.value.limitationsCount", { n: spec.limitations.length })}
            </Text>
          </View>

          {generateError && (
            <Text style={styles.errorText} accessibilityRole="alert" testID="generate-error">
              {t("chat.panel.generateError")}
            </Text>
          )}

          <Pressable
            testID="generate-btn"
            style={[styles.btn, styles.btnPrimary, generateDisabled && styles.btnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={t("chat.panel.generate")}
            accessibilityState={{ disabled: generateDisabled }}
            disabled={generateDisabled}
            onPress={handleGenerate}
          >
            {generating ? (
              <ActivityIndicator color={styles.btnPrimaryText.color} />
            ) : (
              <Text style={styles.btnPrimaryText}>{t("chat.panel.generate")}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* Input row (pinned) */}
      <View style={styles.inputRow}>
        <TextInput
          testID="chat-input"
          style={styles.input}
          value={input}
          editable={!state.streaming}
          placeholder={t("chat.inputPlaceholder")}
          accessibilityLabel={t("chat.inputAria")}
          onChangeText={setInput}
        />
        <Pressable
          testID="send-btn"
          style={[
            styles.btn,
            styles.btnPrimary,
            (state.streaming || input.trim() === "") && styles.btnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel={t("chat.sendAria")}
          accessibilityState={{ disabled: state.streaming || input.trim() === "" }}
          disabled={state.streaming || input.trim() === ""}
          onPress={handleSend}
        >
          <Text style={styles.btnPrimaryText}>{t("chat.send")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function resolveErrorMessage(t: (id: string) => string, reason: string): string {
  if (reason === "chat_stream_timeout") return t("chat.error.chat_stream_timeout");
  if (reason === "chat_stream_failed") return t("chat.error.chat_stream_failed");
  return t("chat.error.generic");
}
