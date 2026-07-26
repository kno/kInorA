/**
 * Mobile "Asistente de voz" screen (item-13 D1) — voice INPUT for create-plan.
 *
 * This is the OD `mobile-voice.html` screen wired to the SHARED create-plan chat
 * foundation from Track C: it records a push-to-talk utterance (`recorder.ts`),
 * uploads it DIRECTLY to `POST /plan-specs/transcribe` (`transcribe-client.ts`,
 * Bearer from SecureStore — no proxy, unlike web), and feeds the returned
 * transcript into the SAME `chat-store.runTurn` path a typed message uses. There
 * is exactly one chat brain (C2a/C2b); voice is only a new way to produce the
 * turn text.
 *
 * State machine (status badge): idle (Listo) → listening (Escuchando, holding
 * the mic) → processing (Procesando, transcribing) → the store's `streaming`
 * drives the responding state (kInorA responde) → idle. Turns are serialized by
 * the store, and the mic is disabled while a turn streams so a recording can
 * never overlap an in-flight turn.
 *
 * Graceful degradation (spec "Voice Interaction" + "Offline Voice Degradation"):
 *   - mic permission denied → the mic is disabled and an inline text composer
 *     keeps the chat fully usable typed (never crashes);
 *   - offline (via NetInfo) → the mic is disabled with the same text fallback;
 *     when connectivity returns the mic re-enables WITHOUT a reload.
 * The API `403` is the real Pro-gate enforcement (surfaced as an error notice).
 *
 * D2 SEAM: native TTS playback of the assistant reply is NOT in D1 (voice input
 * only). The `speak` prop is the single seam D2 wires to `audio/player.ts` — it
 * is left undefined here so D1 ships no audio output. See `handlePressOut`.
 *
 * On unmount the in-flight transcribe is aborted, the recorder is released, and
 * the store is disposed so no late callback mutates a torn-down tree.
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { View, Text, TextInput, Pressable, ScrollView } from "react-native";
import { useIntl } from "react-intl";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { deleteSessionToken } from "../../auth/session-storage";
import {
  transcribeAudio as defaultTranscribe,
  type TranscribeAudio,
  type TranscribeOutcome,
} from "../../api/transcribe-client";
import { createRecorder, type VoiceRecorder } from "../../audio/recorder";
import {
  createChatStore,
  type ChatStore,
  type ChatMessage,
  type ChatStreamFn,
} from "../create-plan/chat-store";
import { styles } from "./VoiceScreen.styles";

/** Injectable direct-transcribe call (defaults to the real client). */
type TranscribeFn = (
  audio: TranscribeAudio,
  options: { apiBaseUrl?: string; getToken?: () => Promise<string | null>; signal?: AbortSignal },
) => Promise<TranscribeOutcome>;

/** Subscribe to connectivity; the callback receives `true` when online. */
type SubscribeConnectivity = (onChange: (online: boolean) => void) => () => void;

export interface VoiceScreenProps {
  navigation: NativeStackNavigationProp<any>;
  /** Chat stream implementation — defaults to `runChatStream`; injected in tests. */
  stream?: ChatStreamFn;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
  /** Mic recorder — defaults to the real `expo-audio` recorder; injected in tests. */
  recorder?: VoiceRecorder;
  /** Direct transcribe client — injected in tests. */
  transcribe?: TranscribeFn;
  /** Clear the stored session on expiry — defaults to `deleteSessionToken`. */
  clearSession?: () => Promise<void>;
  /** Connectivity source — defaults to NetInfo; injected in tests. */
  subscribeConnectivity?: SubscribeConnectivity;
  /** Assume online until the first connectivity event (default true). */
  initialOnline?: boolean;
  /** D2 SEAM: native TTS playback of the assistant reply. Undefined in D1. */
  speak?: (text: string) => void;
}

type LocalStatus = "idle" | "listening" | "processing";
type NoticeKey = "denied" | "offline" | "unclear" | "error" | null;

/** Default NetInfo-backed connectivity subscription (lazy import; device only). */
function defaultSubscribeConnectivity(onChange: (online: boolean) => void): () => void {
  let unsubscribe: (() => void) | null = null;
  let cancelled = false;
  void import("@react-native-community/netinfo").then((mod) => {
    if (cancelled) return;
    unsubscribe = mod.default.addEventListener((state) => {
      onChange(state.isConnected !== false);
    });
  });
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

/** The most recent assistant message text, or null (the D2 TTS input). */
function latestAssistantText(messages: ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.text.trim() !== "") return m.text;
  }
  return null;
}

export default function VoiceScreen({
  navigation,
  stream,
  apiBaseUrl,
  getToken,
  recorder,
  transcribe,
  clearSession,
  subscribeConnectivity,
  initialOnline = true,
  speak,
}: VoiceScreenProps) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });

  // Stable singletons for this screen instance.
  const recorderRef = useRef<VoiceRecorder | null>(null);
  if (recorderRef.current === null) recorderRef.current = recorder ?? createRecorder();
  const transcribeFn = useRef<TranscribeFn>(transcribe ?? defaultTranscribe);
  transcribeFn.current = transcribe ?? defaultTranscribe;
  const clearSessionRef = useRef(clearSession ?? deleteSessionToken);
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const speakRef = useRef(speak);
  speakRef.current = speak;

  const routeToLogin = () => {
    void clearSessionRef.current().finally(() => {
      navigationRef.current.reset({ index: 0, routes: [{ name: "Login" }] });
    });
  };

  const storeRef = useRef<ChatStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createChatStore({
      greeting: t("chat.greeting"),
      stream,
      apiBaseUrl,
      getToken,
      onSessionExpired: routeToLogin,
    });
  }
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getState);

  const [status, setStatus] = useState<LocalStatus>("idle");
  const [notice, setNotice] = useState<NoticeKey>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [online, setOnline] = useState(initialOnline);
  const [showText, setShowText] = useState(false);
  const [textInput, setTextInput] = useState("");

  const recordingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const disposedRef = useRef(false);

  // Request the mic permission once on mount; denial drives the text fallback.
  useEffect(() => {
    let cancelled = false;
    void recorderRef.current!.requestPermission().then((outcome) => {
      if (cancelled || disposedRef.current) return;
      if (outcome === "denied") {
        setMicDenied(true);
        setNotice("denied");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Connectivity: disable the mic offline, re-enable gracefully on recovery.
  useEffect(() => {
    const subscribe = subscribeConnectivity ?? defaultSubscribeConnectivity;
    const unsubscribe = subscribe((next) => {
      if (disposedRef.current) return;
      setOnline(next);
      setNotice((prev) => {
        if (!next) return "offline";
        // Clear only the offline notice on recovery; leave others intact.
        return prev === "offline" ? null : prev;
      });
    });
    return unsubscribe;
  }, [subscribeConnectivity]);

  // Teardown: abort the transcribe, release the recorder, dispose the store.
  useEffect(
    () => () => {
      disposedRef.current = true;
      abortRef.current?.abort();
      recorderRef.current?.release();
      store.dispose();
    },
    [store],
  );

  // Disable the mic whenever a NEW recording must not begin: mic denied,
  // offline, a turn already streaming, OR a transcribe already in flight
  // (`processing`). Without the `processing` guard a second press-and-hold
  // during transcription would start an overlapping recording + transcribe,
  // overwrite the first `AbortController` (leaking the first upload on unmount),
  // and have its transcript silently dropped by the store's serialized runTurn.
  const micDisabled =
    micDenied || !online || state.streaming || status === "processing";

  const handlePressIn = async () => {
    if (micDisabled || recordingRef.current) return;
    setNotice(null);
    try {
      await recorderRef.current!.start();
      if (disposedRef.current) return;
      recordingRef.current = true;
      setStatus("listening");
    } catch {
      if (disposedRef.current) return;
      setStatus("idle");
      setNotice("error");
    }
  };

  const handlePressOut = async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    setStatus("processing");

    let result;
    try {
      result = await recorderRef.current!.stop();
    } catch {
      if (disposedRef.current) return;
      setStatus("idle");
      setNotice("error");
      return;
    }
    if (disposedRef.current) return;
    if (!result) {
      setStatus("idle");
      setNotice("unclear");
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const outcome = await transcribeFn.current(result, {
      apiBaseUrl,
      getToken,
      signal: controller.signal,
    });
    if (disposedRef.current) return;

    if (outcome.kind === "error") {
      setStatus("idle");
      if (outcome.sessionExpired) {
        routeToLogin();
        return;
      }
      setNotice("error");
      return;
    }
    if (outcome.unclear || outcome.text.trim() === "") {
      setStatus("idle");
      setNotice("unclear");
      return;
    }

    // Feed the transcript into the SHARED chat turn (identical to a typed send).
    setStatus("idle");
    await store.runTurn(outcome.text, true);

    // D2 SEAM: speak the terminal assistant reply. No-op in D1 (`speak` unset).
    if (!disposedRef.current) {
      const reply = latestAssistantText(store.getState().messages);
      if (reply) speakRef.current?.(reply);
    }
  };

  const handleSendText = async () => {
    const message = textInput.trim();
    if (message === "" || state.streaming) return;
    setTextInput("");
    setNotice(null);
    await store.runTurn(message, true);
  };

  const statusKey = state.streaming
    ? "voice.state.responding"
    : status === "listening"
      ? "voice.state.listening"
      : status === "processing"
        ? "voice.state.processing"
        : "voice.state.idle";
  const statusActive = status === "listening" || state.streaming;
  const textVisible = showText || micDenied || !online;

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable
          testID="back-btn"
          style={styles.iconBtn}
          accessibilityRole="button"
          accessibilityLabel={t("voice.backAria")}
          onPress={() => navigationRef.current.goBack()}
        >
          <Text style={styles.iconBtnText}>←</Text>
        </Pressable>
        <Text style={styles.topBarTitle}>{t("voice.screenTitle")}</Text>
        <View style={[styles.statusBadge, statusActive && styles.statusBadgeActive]}>
          <View style={[styles.statusDot, statusActive && styles.statusDotActive]} />
          <Text
            testID="voice-status"
            style={[styles.statusText, statusActive && styles.statusTextActive]}
            accessibilityLiveRegion="polite"
          >
            {t(statusKey)}
          </Text>
        </View>
      </View>

      {/* Orb + transcript */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.orbArea}>
        <View style={[styles.orbCore, statusActive && styles.orbCoreActive]}>
          <View style={styles.waveform}>
            {[14, 24, 36, 48, 36, 52, 28, 40, 20].map((h, i) => (
              <View
                key={i}
                style={[
                  styles.waveBar,
                  statusActive && styles.waveBarActive,
                  { height: statusActive ? h : 6 },
                ]}
              />
            ))}
          </View>
        </View>

        <View style={styles.transcript}>
          {state.messages.map((m, i) => (
            <View key={i} style={styles.transcriptLine}>
              <Text
                style={[
                  styles.transcriptRole,
                  m.role === "assistant" && styles.transcriptRoleCoach,
                ]}
              >
                {m.role === "assistant" ? t("voice.roleCoach") : t("voice.roleYou")}
              </Text>
              <View
                style={[
                  styles.transcriptBubble,
                  m.role === "user" ? styles.transcriptBubbleUser : styles.transcriptBubbleCoach,
                ]}
              >
                <Text testID="voice-bubble" style={styles.transcriptText}>
                  {m.text}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {notice && (
          <View style={styles.notice} accessibilityRole="alert">
            <Text testID="voice-notice" style={styles.noticeText}>
              {t(`voice.${notice}`)}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Inline text fallback composer (mic-denied / offline / keyboard toggle) */}
      {textVisible && (
        <View style={styles.composerRow}>
          <TextInput
            testID="voice-text-input"
            style={styles.composerInput}
            value={textInput}
            editable={!state.streaming}
            placeholder={t("chat.inputPlaceholder")}
            accessibilityLabel={t("chat.inputAria")}
            onChangeText={setTextInput}
          />
          <Pressable
            testID="voice-send-btn"
            style={[styles.sideBtn, (state.streaming || textInput.trim() === "") && styles.micBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={t("chat.sendAria")}
            accessibilityState={{ disabled: state.streaming || textInput.trim() === "" }}
            disabled={state.streaming || textInput.trim() === ""}
            onPress={handleSendText}
          >
            <Text style={styles.sideBtnText}>{t("chat.send")}</Text>
          </Pressable>
        </View>
      )}

      {/* Bottom controls: keyboard fallback · push-to-talk mic · end session */}
      <View style={styles.bottomControls}>
        <Pressable
          testID="keyboard-btn"
          style={styles.sideBtn}
          accessibilityRole="button"
          accessibilityLabel={t("voice.keyboardAria")}
          onPress={() => setShowText((v) => !v)}
        >
          <Text style={styles.sideBtnText}>⌨</Text>
        </Pressable>

        <View style={styles.micColumn}>
          <Text style={[styles.micLabel, status === "listening" && styles.micLabelActive]}>
            {status === "listening" ? t("voice.state.listening") : t("voice.hold")}
          </Text>
          <Pressable
            testID="mic-btn"
            style={[
              styles.micBtn,
              status === "listening" && styles.micBtnActive,
              micDisabled && styles.micBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t("voice.micLabel")}
            accessibilityState={{ disabled: micDisabled }}
            disabled={micDisabled}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
          >
            <Text style={styles.micBtnText}>●</Text>
          </Pressable>
        </View>

        <Pressable
          testID="end-btn"
          style={[styles.sideBtn, styles.endBtn]}
          accessibilityRole="button"
          accessibilityLabel={t("voice.endSessionAria")}
          onPress={() => navigationRef.current.goBack()}
        >
          <Text style={[styles.sideBtnText, styles.endBtnText]}>{t("voice.endSession")}</Text>
        </Pressable>
      </View>
    </View>
  );
}
