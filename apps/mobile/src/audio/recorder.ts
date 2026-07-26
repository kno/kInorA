/**
 * Expo mic capture for the mobile "Asistente de voz" screen (item-13 D1).
 *
 * Push-to-talk voice INPUT only: request the mic permission, record a short
 * utterance to an on-device `.m4a` file, and hand its URI to the direct
 * transcribe client (`src/api/transcribe-client.ts`). Raw audio lives ONLY as
 * the on-device file + the in-flight upload — it is never persisted by the app
 * and never leaves this device except as the transcribe request body.
 *
 * The native surface (`expo-audio`) is reached through a structural
 * {@link AudioBackend} seam so this module is unit-testable under vitest with a
 * fake backend — no device, no `expo-audio` import at test time. The default
 * backend lazy-imports `expo-audio` inside its factory (mirroring how
 * `session-storage`/`plan-draft-client` defer `expo-secure-store`) so importing
 * this module never pulls React Native's Flow-typed native entry into the test
 * graph.
 *
 * NO `openai`/LLM import — mobile only ships audio bytes (deps-guard clean).
 */

/** A finished recording ready to upload multipart to `/plan-specs/transcribe`. */
export interface RecordingResult {
  /** On-device file URI (e.g. `file:///.../recording.m4a`). */
  uri: string;
  /** MIME type for the multipart part — in the API's transcribe allow-list. */
  contentType: string;
  /** Filename hint (extension routes Whisper's decoder). */
  fileName: string;
}

/** Mic permission outcome — `denied` drives the text-input fallback. */
export type PermissionOutcome = "granted" | "denied";

/**
 * Structural native-audio surface. Kept minimal and framework-free so a vitest
 * fake satisfies it and the recorder never depends on `expo-audio` typings in
 * tests. The default implementation ({@link createExpoAudioBackend}) adapts
 * `expo-audio`'s `AudioRecorder` to this shape.
 */
export interface AudioBackend {
  /** Prompt for (or read) the mic permission; `true` = granted. */
  requestPermission(): Promise<boolean>;
  /** Configure the audio session and prepare a fresh recording. */
  prepare(): Promise<void>;
  /** Begin capturing. */
  start(): void;
  /** Stop capturing (the file is finalized once this resolves). */
  stop(): Promise<void>;
  /** The finalized recording's URI, or `null` if none. */
  getUri(): string | null;
  /** Release native resources. */
  release(): void;
}

export interface VoiceRecorder {
  requestPermission(): Promise<PermissionOutcome>;
  /** Prepare + begin a push-to-talk capture. */
  start(): Promise<void>;
  /** Finalize the capture; resolves the file result, or `null` if none. */
  stop(): Promise<RecordingResult | null>;
  /** Abort/tear down; safe to call repeatedly (unmount). */
  release(): void;
}

/** Expo default recording container on iOS/Android (allow-listed by the API). */
const M4A_CONTENT_TYPE = "audio/m4a";
const M4A_FILE_NAME = "audio.m4a";

/**
 * Create a push-to-talk recorder over an injectable {@link AudioBackend}.
 * The backend is created lazily on first use (via `backendFactory`) so no
 * native module is touched until the user actually records.
 */
export function createRecorder(
  backendFactory: () => Promise<AudioBackend> = createExpoAudioBackend,
): VoiceRecorder {
  let backend: AudioBackend | null = null;
  let recording = false;

  const ensure = async (): Promise<AudioBackend> => {
    if (!backend) backend = await backendFactory();
    return backend;
  };

  return {
    async requestPermission() {
      const b = await ensure();
      return (await b.requestPermission()) ? "granted" : "denied";
    },
    async start() {
      const b = await ensure();
      await b.prepare();
      b.start();
      recording = true;
    },
    async stop() {
      // Guard a stop with no active capture (denied/aborted/torn-down) so the
      // caller never crashes on a missing recorder.
      if (!backend || !recording) return null;
      recording = false;
      await backend.stop();
      const uri = backend.getUri();
      if (!uri) return null;
      return { uri, contentType: M4A_CONTENT_TYPE, fileName: M4A_FILE_NAME };
    },
    release() {
      recording = false;
      backend?.release();
      backend = null;
    },
  };
}

/**
 * Default backend adapting `expo-audio`'s `AudioRecorder`. Lazy-imported so the
 * module graph stays test-friendly (see file header). Uses the HIGH_QUALITY
 * preset (`.m4a` on iOS/Android) and enables the recording audio session.
 */
async function createExpoAudioBackend(): Promise<AudioBackend> {
  const {
    AudioRecorder,
    RecordingPresets,
    requestRecordingPermissionsAsync,
    setAudioModeAsync,
  } = await import("expo-audio");

  let recorder: AudioRecorderInstance | null = null;

  return {
    async requestPermission() {
      const res = await requestRecordingPermissionsAsync();
      return res.granted;
    },
    async prepare() {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      recorder = new AudioRecorder(RecordingPresets.HIGH_QUALITY ?? {});
      await recorder.prepareToRecordAsync();
    },
    start() {
      recorder?.record();
    },
    async stop() {
      await recorder?.stop();
    },
    getUri() {
      return recorder?.uri ?? null;
    },
    release() {
      recorder?.release();
      recorder = null;
    },
  };
}

/** The subset of `expo-audio`'s `AudioRecorder` this backend drives. */
type AudioRecorderInstance = {
  uri: string | null;
  record(): void;
  stop(): Promise<void>;
  prepareToRecordAsync(): Promise<void>;
  release(): void;
};
