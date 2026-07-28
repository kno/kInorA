"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { PlanSpecDraftSchema, type PlanGoal, type TrainingLocation } from "@kinora/contracts";
import { parseSSEStream } from "./chat-stream";
import type { ChatDraftSpec } from "./chat-types";
import {
  TranscriptionError,
  selectMimeType,
  synthesizeSpeech,
  transcribeAudio,
} from "./voice-client";
import styles from "./assistant-pane.module.css";

/** Voice capture sub-mode states (13 Slice B1). */
type VoiceState = "idle" | "listening" | "processing";
/**
 * A transient voice notice key resolved against the `voice` i18n namespace:
 * `denied` (mic blocked), `unsupported` (no MediaRecorder), `offline`,
 * `unclear` (silence/noise transcript), or `error` (transport failure).
 */
type VoiceNotice = "denied" | "unsupported" | "offline" | "unclear" | "error" | null;

/** Same-origin proxy route that injects the Bearer token and streams SSE back. */
const CHAT_ENDPOINT = "/create-plan/chat";

/**
 * A 44-byte valid, silent WAV (RIFF/WAVE header, zero audio samples) used to
 * "prime" the hidden `<audio>` element inside the real mic-tap gesture. Playing
 * (then immediately pausing) this in-gesture engages the media element under
 * the browser's autoplay policy, so the later programmatic `.play()` in
 * `playReply` — which fires seconds after the click, well outside the transient
 * user-activation window — is allowed instead of silently blocked. It is a
 * literal `data:` URI (NOT `URL.createObjectURL`), so it needs no revocation.
 */
const SILENT_WAV_DATA_URI =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

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
  // Inline add-item drafts for the panel's equipment / limitations editors
  // (the array fields the chat can populate but the panel could previously only
  // display as counts). Kept local; a committed add flows through `editField`.
  const [equipmentDraft, setEquipmentDraft] = useState("");
  const [limitationDraft, setLimitationDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState(false);
  const [generating, setGenerating] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const lastUserMessageRef = useRef<string>("");
  // Text input + focus management: the input is focused on mount (so the page
  // lands ready to type) and again each time a turn finishes, so the user can
  // answer the assistant's next question by just typing — no mouse reach.
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-scroll: keep the thread pinned to the latest message as replies stream
  // in, but ONLY while the user is already near the bottom — if they scrolled up
  // to read earlier messages we must NOT yank them back down on every token.
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  // --- Voice sub-mode (B1: capture + transcribe → existing chat turn) ---
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceNotice, setVoiceNotice] = useState<VoiceNotice>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [online, setOnline] = useState(true);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const voiceAbortRef = useRef<AbortController | null>(null);
  // Whether the NEXT `onstop` should transcribe. A user-initiated stop
  // transcribes; an auto-stop (connectivity dropped mid-recording) only
  // releases the mic and returns to idle, never sending audio over a dead link.
  const shouldTranscribeRef = useRef(true);
  // Latest "cancel the current recording" closure, kept fresh so the stable
  // offline listener can release a hot mic without re-subscribing.
  const cancelRecordingRef = useRef<() => void>(() => {});

  // --- Voice OUTPUT playback (B2: speak the assistant reply after a voice turn) ---
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  // The object URL for the current audio Blob — revoked after playback/stop so a
  // played reply never leaks a blob: URL.
  const objectUrlRef = useRef<string | null>(null);

  // Abort any in-flight stream on unmount/navigation so no token write lands in
  // an unmounted tree and the upstream API sees the disconnect.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Focus the text input on mount (page lands ready to type) and again whenever
  // a turn finishes (streaming → false), so the user can answer without reaching
  // for the mouse. The textarea is `disabled` while streaming; deferring the
  // focus to the next animation frame guarantees it runs after the re-enable has
  // painted and wins any competing focus (e.g. the Send button after a click).
  useEffect(() => {
    if (streaming) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [streaming]);

  // Keep the thread scrolled to the latest message whenever it changes (new
  // turn, streaming tokens, terminal draft) — but only when the user is already
  // pinned to the bottom (see stickToBottomRef, updated by onScroll below).
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Track whether the user is near the bottom so streaming replies keep
  // auto-following, but scrolling up to read history pauses the auto-scroll.
  const handleMessagesScroll = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  // Feature-detect voice at mount (client-only): the browser needs both
  // getUserMedia and MediaRecorder. Detected in an effect so SSR never touches
  // `navigator`/`MediaRecorder`.
  useEffect(() => {
    setVoiceSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function" &&
        typeof MediaRecorder !== "undefined",
    );
  }, []);

  // Track connectivity so voice degrades to disabled offline and recovers
  // gracefully (no reload) when the connection returns — text input is never
  // affected either way. Losing the connection MID-RECORDING auto-stops so the
  // mic is released immediately (the button that could stop it is otherwise
  // disabled while offline — a hot-mic lockout otherwise).
  useEffect(() => {
    if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    const goOnline = () => {
      setOnline(true);
      setVoiceNotice((prev) => (prev === "offline" ? null : prev));
    };
    const goOffline = () => {
      setOnline(false);
      cancelRecordingRef.current();
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Keep the cancel-recording closure current for the stable offline listener.
  // Auto-stop halts capture WITHOUT transcribing (network is gone) and releases
  // the mic; if no recorder is active it still clears any held stream.
  useEffect(() => {
    cancelRecordingRef.current = () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        shouldTranscribeRef.current = false;
        recorder.stop();
      } else {
        releaseMic();
      }
      setVoiceState("idle");
    };
  });

  // Release the mic + abort any in-flight transcription on unmount.
  useEffect(() => {
    return () => {
      voiceAbortRef.current?.abort();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // Revoke the current audio object URL (idempotent) so a played reply never
  // leaks a `blob:` URL after playback finishes, is stopped, or is superseded.
  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  /**
   * Stop any in-flight/playing TTS: abort the pending speech fetch, pause the
   * `<audio>` element, and revoke the object URL. Safe to call when nothing is
   * playing. Used by the stop-speaking control, a new turn, and unmount.
   */
  const stopSpeaking = useCallback(() => {
    speechAbortRef.current?.abort();
    const audio = audioRef.current;
    if (audio) audio.pause();
    revokeObjectUrl();
    setSpeaking(false);
  }, [revokeObjectUrl]);

  /**
   * Engage the hidden `<audio>` element inside the real user gesture (the mic
   * tap) so a later programmatic `playReply()` is permitted by the browser's
   * autoplay policy. Playing a silent WAV then immediately pausing marks the
   * element as user-activated for the page session; subsequent `.play()` calls
   * that fire seconds later (after transcribe + SSE) no longer get blocked.
   *
   * Best-effort and fully fail-silent: if the browser still refuses (or the
   * element is not mounted / not yet playable) the error is swallowed and the
   * TTS layer simply stays a no-op — text chat is never affected. It never
   * touches `voiceState`/`streaming`, so it can never wedge the capture flow,
   * and it is safe (idempotent) to call on every mic tap. `playReply` always
   * overwrites `audio.src` with the reply's object URL, so priming's silent
   * `src` is harmlessly replaced by real audio when a reply arrives.
   */
  const primeAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.src = SILENT_WAV_DATA_URI;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
    } catch {
      // Autoplay still blocked / element not ready → swallow; TTS is optional.
    }
  }, []);

  /**
   * Play the terminal assistant reply as TTS audio (B2). Fetches the mp3 from
   * the same-origin speech proxy and plays it via the `<audio>` element. This is
   * gesture-anchored: it only runs for a VOICE-initiated turn (the user tapped
   * the mic), so `.play()` sits within the page's user-gesture chain. TTS is a
   * best-effort enhancement over the already-shown text reply, so EVERY failure
   * path (a 204 opt-out, a 403/502, a network error, an aborted turn, a blocked
   * autoplay) fails silently — the chat is never disrupted. Any prior playback
   * is stopped first so a new reply supersedes the last.
   */
  const playReply = useCallback(
    async (text: string) => {
      // Never attempt playback offline (no voice turn can start offline anyway).
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      // Supersede any prior playback (abort its fetch, stop its audio, revoke).
      stopSpeaking();

      const controller = new AbortController();
      speechAbortRef.current = controller;
      try {
        const blob = await synthesizeSpeech(text, { signal: controller.signal });
        // 204 opt-out / non-2xx / empty → nothing to play; or the turn was
        // superseded/aborted while the fetch was in flight.
        if (!blob || controller.signal.aborted) return;
        const audio = audioRef.current;
        if (!audio) return;

        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        audio.src = url;
        audio.onended = () => {
          revokeObjectUrl();
          setSpeaking(false);
        };
        setSpeaking(true);
        // `play()` may reject (autoplay policy / interrupted) — fail silently.
        await Promise.resolve(audio.play()).catch(() => {
          revokeObjectUrl();
          setSpeaking(false);
        });
      } catch {
        // Network error / abort → no playback; the text reply already stands.
        revokeObjectUrl();
        setSpeaking(false);
      }
    },
    [revokeObjectUrl, stopSpeaking],
  );

  // Abort + revoke any in-flight/playing TTS on unmount so no `blob:` URL leaks
  // and no audio keeps playing into an unmounted tree.
  useEffect(() => {
    return () => {
      speechAbortRef.current?.abort();
      audioRef.current?.pause();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  /**
   * Run one turn. `appendUserMessage` is false on retry: the ORIGINAL user
   * bubble is reused (not re-sent to the thread) so an error + retry reads
   * naturally — one user message, one assistant reply — instead of showing a
   * duplicated user bubble. A fresh, empty assistant placeholder is always
   * appended to receive the incoming tokens/terminal text.
   */
  const runTurn = useCallback(
    async (message: string, appendUserMessage: boolean, speakReply = false) => {
      // Turn serialization: never overlap turns (prevents the shared-draft
      // lost-update from two concurrent commits).
      if (streaming) return;

      // A new turn supersedes any TTS still playing/loading from the prior turn.
      stopSpeaking();

      lastUserMessageRef.current = message;
      // The user just sent a turn — follow it and its reply to the bottom even
      // if they had scrolled up earlier.
      stickToBottomRef.current = true;
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
              // Voice-initiated turn only: speak the terminal reply (B2).
              // Gesture-anchored to the mic tap that started this turn.
              if (speakReply) void playReply(event.assistantMessage);
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
    [streaming, onSpecChange, stopSpeaking, playReply],
  );

  const releaseMic = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  /**
   * A finished recording: transcribe the captured blob, then feed a clear
   * transcript into the EXISTING `runTurn` path (byte-identical to a typed
   * message). Silence/noise (`unclear` or empty) re-prompts WITHOUT starting a
   * chat turn; a transport failure shows a gentle "try again". Raw audio never
   * leaves this function beyond the in-flight upload.
   */
  const transcribeAndRun = useCallback(
    async (blob: Blob) => {
      if (blob.size === 0) {
        setVoiceState("idle");
        setVoiceNotice("unclear");
        return;
      }
      setVoiceState("processing");
      const controller = new AbortController();
      voiceAbortRef.current = controller;
      try {
        const { text, unclear } = await transcribeAudio(blob, { signal: controller.signal });
        setVoiceState("idle");
        if (unclear || text.trim() === "") {
          setVoiceNotice("unclear");
          return;
        }
        // Voice-initiated turn: request TTS playback of the terminal reply (B2).
        void runTurn(text, true, true);
      } catch (err) {
        setVoiceState("idle");
        // A user-initiated abort (unmount) is expected — stay silent.
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof TranscriptionError || err instanceof Error) {
          setVoiceNotice("error");
        }
      }
    },
    [runTurn],
  );

  const startRecording = useCallback(async () => {
    // Clear any prior notice (incl. a previous denial) so a retry can recover
    // in-session once the user grants permission.
    setVoiceNotice(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Permission denied or unavailable → show the message, keep text usable.
      // The mic stays retry-able (a later grant recovers without a reload).
      setVoiceNotice("denied");
      return;
    }
    // The stream is acquired: hold it BEFORE building the recorder so any
    // failure below still releases the mic (no leaked hot mic / second stream).
    streamRef.current = stream;
    chunksRef.current = [];
    try {
      const mimeType = selectMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        releaseMic();
        // Auto-stop (offline) only releases the mic; a user stop transcribes.
        if (shouldTranscribeRef.current) {
          void transcribeAndRun(blob);
        } else {
          setVoiceState("idle");
        }
      };
      recorderRef.current = recorder;
      shouldTranscribeRef.current = true;
      recorder.start();
      setVoiceState("listening");
    } catch {
      // Constructor/start() threw (e.g. an unconstructable mimeType) — release
      // the acquired stream so the mic never stays hot, and recover to idle.
      releaseMic();
      setVoiceState("idle");
      setVoiceNotice("error");
    }
  }, [releaseMic, transcribeAndRun]);

  const stopRecording = useCallback(() => {
    // A user stop transcribes; the recorder's `onstop` handler drives it. Here
    // we only halt capture and move the UI into the processing state.
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      shouldTranscribeRef.current = true;
      recorderRef.current.stop();
    }
    setVoiceState("processing");
  }, []);

  const handleMicClick = () => {
    if (voiceState === "listening") {
      stopRecording();
    } else if (voiceState === "idle") {
      // Prime the audio element WITHIN this real gesture (fire-and-forget, no
      // await before it) so the reply's later programmatic playback is allowed
      // by the browser's autoplay policy. It never blocks the recording start
      // and never touches voiceState, so it cannot wedge the capture flow.
      void primeAudio();
      void startRecording();
    }
    // While "processing" the mic is disabled; ignore clicks.
  };

  // Conditions that block STARTING a recording. They deliberately do NOT block
  // STOPPING one already in flight — otherwise dropping offline mid-recording
  // would strand a hot mic with no way to release it from the UI.
  const voiceStartDisabled = streaming || generating || !online || !voiceSupported;
  const micButtonDisabled =
    voiceState === "listening"
      ? false
      : voiceState === "processing"
        ? true
        : voiceStartDisabled;

  const voiceStatusLabel =
    voiceState === "listening"
      ? t("voice.state.listening")
      : voiceState === "processing"
        ? t("voice.state.processing")
        : t("voice.state.idle");

  // Prefer the connectivity/support notice when it dominates; otherwise the
  // last transient notice (denied/unclear/error).
  const voiceNoticeKey: VoiceNotice = !online
    ? "offline"
    : !voiceSupported
      ? "unsupported"
      : voiceNotice;
  const voiceNoticeMessage = voiceNoticeKey ? t(`voice.${voiceNoticeKey}`) : null;

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

  // --- Panel array editors (equipment / limitations) ---
  // Inline per-item add/remove reusing the wizard's chip pattern. Both share
  // the SAME `editField` path a scalar edit uses, so a panel array change
  // updates the shared draft and persists to the server draft identically. An
  // empty draft is ignored; equipment is de-duplicated case-insensitively.

  /** Add the typed equipment value (trimmed) unless blank or a case-insensitive dup. */
  const addEquipment = () => {
    const text = equipmentDraft.trim();
    setEquipmentDraft("");
    if (text === "") return;
    const current = spec.equipment ?? [];
    if (current.some((v) => v.toLowerCase() === text.toLowerCase())) return;
    editField({ equipment: [...current, text] });
  };

  // Remove by INDEX (not value): equipment is a plain `string[]` with no
  // uniqueness guarantee (a draft can carry duplicates), so a value filter would
  // drop every value-equal entry at once. Mirrors `removeLimitation`.
  const removeEquipment = (index: number) => {
    const current = spec.equipment ?? [];
    editField({ equipment: current.filter((_, i) => i !== index) });
  };

  /** Add the typed limitation (trimmed, `isWarning: true`) unless blank. */
  const addLimitation = () => {
    const text = limitationDraft.trim();
    setLimitationDraft("");
    if (text === "") return;
    const current = spec.limitations ?? [];
    editField({ limitations: [...current, { text, isWarning: true }] });
  };

  const removeLimitation = (index: number) => {
    const current = spec.limitations ?? [];
    editField({ limitations: current.filter((_, i) => i !== index) });
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

        <div
          className={`${styles.messages} kin-scroll`}
          ref={messagesRef}
          onScroll={handleMessagesScroll}
        >
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

        {/* Voice affordance (B1): mic status + a gentle notice for denied /
            unclear / offline / unsupported / error. Uses role="status" (not
            "alert") so it never collides with the chat error's alert. */}
        <div
          className={`${styles.voiceBar} ${styles[`voice_${voiceState}`] ?? ""}`}
          data-voice-state={voiceState}
        >
          <span className={styles.voiceStatus} aria-live="polite">
            {speaking ? t("voice.state.speaking") : voiceStatusLabel}
          </span>
          {voiceNoticeMessage && (
            <span className={styles.voiceNotice} role="status">
              {voiceNoticeMessage}
            </span>
          )}
          {/* Stop-speaking (mute) affordance — only while TTS is playing (B2). */}
          {speaking && (
            <button
              type="button"
              className={`kin-btn ${styles.stopSpeakingBtn ?? ""}`}
              aria-label={t("voice.stopSpeakingAria")}
              onClick={stopSpeaking}
            >
              {t("voice.stopSpeaking")}
            </button>
          )}
        </div>

        {/* Hidden audio sink for TTS playback (B2). The reply's mp3 Blob is set
            as an object URL and played gesture-anchored to the mic tap; the URL
            is revoked on end/stop/unmount so no `blob:` URL leaks. */}
        <audio ref={audioRef} hidden aria-hidden="true" />


        <div className={styles.inputRow}>
          <button
            type="button"
            className={`kin-btn ${styles.micBtn} ${
              voiceState === "listening" ? styles.micBtnActive : ""
            }`}
            aria-label={voiceState === "listening" ? t("voice.stopAria") : t("voice.startAria")}
            aria-pressed={voiceState === "listening"}
            title={t("voice.micLabel")}
            disabled={micButtonDisabled}
            onClick={handleMicClick}
          >
            <span aria-hidden="true">{voiceState === "listening" ? "■" : "🎤"}</span>
          </button>
          <textarea
            ref={inputRef}
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
                disabled={streaming}
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
                disabled={streaming}
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
                disabled={streaming}
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
                disabled={streaming}
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
              <div className={styles.arrayEditor}>
                <div className={styles.arrayInputRow}>
                  <input
                    type="text"
                    className="kin-input"
                    aria-label={t("wizard.equipment.addAria")}
                    placeholder={t("wizard.equipment.addPlaceholder")}
                    value={equipmentDraft}
                    disabled={streaming}
                    onChange={(e) => setEquipmentDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addEquipment();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="kin-btn"
                    disabled={streaming}
                    onClick={addEquipment}
                  >
                    {t("wizard.equipment.addButton")}
                  </button>
                </div>
                {spec.equipment && spec.equipment.length > 0 ? (
                  <ul className={styles.chips}>
                    {spec.equipment.map((item, index) => (
                      <li key={`${item}-${index}`} className={styles.chip}>
                        {item}
                        <button
                          type="button"
                          className={styles.chipRemove}
                          aria-label={t("wizard.chip.removeAria", { name: item })}
                          disabled={streaming}
                          onClick={() => removeEquipment(index)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className={styles.fieldValue}>{t("chat.panel.notSet")}</span>
                )}
              </div>
            </div>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>{t("chat.field.limitations")}</span>
              <div className={styles.arrayEditor}>
                <div className={styles.arrayInputRow}>
                  <input
                    type="text"
                    className="kin-input"
                    aria-label={t("wizard.limitations.addAria")}
                    placeholder={t("wizard.limitations.addPlaceholder")}
                    value={limitationDraft}
                    disabled={streaming}
                    onChange={(e) => setLimitationDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addLimitation();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="kin-btn"
                    disabled={streaming}
                    onClick={addLimitation}
                  >
                    {t("wizard.limitations.addButton")}
                  </button>
                </div>
                {spec.limitations && spec.limitations.length > 0 ? (
                  <ul className={styles.chips}>
                    {spec.limitations.map((limitation, index) => (
                      <li key={`${limitation.text}-${index}`} className={styles.chip}>
                        {limitation.text}
                        <button
                          type="button"
                          className={styles.chipRemove}
                          aria-label={t("wizard.chip.removeAria", { name: limitation.text })}
                          disabled={streaming}
                          onClick={() => removeLimitation(index)}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className={styles.fieldValue}>{t("chat.panel.notSet")}</span>
                )}
              </div>
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
