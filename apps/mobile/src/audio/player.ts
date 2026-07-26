/**
 * Native TTS playback for the mobile "Asistente de voz" screen (item-13 D2).
 *
 * Voice OUTPUT only: play the mp3 the API returns from `POST /plan-specs/speech`
 * for the terminal assistant reply of a voice turn (parity with the web
 * `<audio>` playback in `AssistantPane`). This is a best-effort enhancement over
 * the already-shown text reply — the caller (`VoiceScreen`) fails silently on
 * every error path, so this module only has to play cleanly and release.
 *
 * The native surface (`expo-audio`) is reached through a structural
 * {@link AudioPlayerBackend} seam — mirroring `recorder.ts` — so this module is
 * unit-testable under vitest with a fake backend (no device, no `expo-audio`
 * import at test time). The default backend lazy-imports `expo-audio` inside its
 * factory so importing this module never pulls React Native's Flow-typed native
 * entry into the test graph.
 *
 * Playback is single-reply: {@link AudioPlayer.play} stops any current playback
 * before starting a new one (no overlap), and native resources are released on
 * stop, on natural completion, and on teardown. Audio bytes live ONLY in the
 * in-flight response + the data URI handed to the native player — nothing is
 * persisted. NO `openai`/LLM import (deps-guard clean).
 */

/** A playable reply: either a ready URI or raw mp3 bytes + their MIME type. */
export type PlayableSource =
  | { uri: string }
  | { bytes: Uint8Array; contentType: string };

/**
 * Structural native-playback surface. Kept minimal and framework-free so a
 * vitest fake satisfies it and the player never depends on `expo-audio` typings
 * in tests. {@link createExpoAudioPlayerBackend} adapts `expo-audio`'s player.
 */
export interface AudioPlayerBackend {
  /** Load a source (file/data URI) and register the natural-completion callback. */
  load(uri: string, onEnded: () => void): Promise<void>;
  /** Begin playback of the loaded source. */
  play(): void;
  /** Stop playback (resolves once halted). */
  stop(): Promise<void>;
  /** Release native resources. */
  release(): void;
}

export interface AudioPlayer {
  /**
   * Play a reply. Any current playback is stopped + released first (no overlap).
   * `onEnded` fires once when playback finishes naturally.
   */
  play(source: PlayableSource, onEnded?: () => void): Promise<void>;
  /** Stop playback and release native resources; safe when nothing is playing. */
  stop(): Promise<void>;
  /** Tear down the native backend; safe to call repeatedly (unmount). */
  release(): void;
}

/**
 * Create a single-reply player over an injectable {@link AudioPlayerBackend}.
 * The backend is created lazily per playback (via `backendFactory`) so no native
 * module is touched until the app actually speaks, and each reply gets a fresh
 * player instance the previous one having been released.
 */
export function createPlayer(
  backendFactory: () => Promise<AudioPlayerBackend> = createExpoAudioPlayerBackend,
): AudioPlayer {
  let backend: AudioPlayerBackend | null = null;

  const teardown = () => {
    backend?.release();
    backend = null;
  };

  const stop = async (): Promise<void> => {
    // No active playback → nothing to stop (idempotent).
    if (!backend) return;
    const current = backend;
    backend = null;
    await current.stop();
    current.release();
  };

  return {
    async play(source, onEnded) {
      // Supersede any prior playback so a new reply never overlaps the last.
      await stop();
      const uri = toUri(source);
      const b = await backendFactory();
      backend = b;
      await b.load(uri, () => {
        // Natural completion: release this instance and notify the caller.
        if (backend === b) teardown();
        onEnded?.();
      });
      b.play();
    },
    stop,
    release: teardown,
  };
}

/** Build a playable URI: pass a URI through, or inline bytes as a data URI. */
function toUri(source: PlayableSource): string {
  if ("uri" in source) return source.uri;
  return `data:${source.contentType};base64,${bytesToBase64(source.bytes)}`;
}

/**
 * Portable base64 encoder (no `Buffer`/`btoa` dependency) so the same bytes →
 * data URI conversion runs identically under vitest (Node) and Hermes (RN),
 * where neither global is guaranteed.
 */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[b2 & 0x3f] : "=";
  }
  return out;
}

/**
 * Default backend adapting `expo-audio`'s player. Lazy-imported so the module
 * graph stays test-friendly (see file header). Plays the mp3 data/file URI and
 * reports natural completion via the playback status listener.
 */
async function createExpoAudioPlayerBackend(): Promise<AudioPlayerBackend> {
  const { createAudioPlayer, setAudioModeAsync } = await import("expo-audio");

  let player: AudioPlayerInstance | null = null;
  let subscription: { remove(): void } | null = null;

  return {
    async load(uri, onEnded) {
      await setAudioModeAsync({ playsInSilentMode: true });
      player = createAudioPlayer({ uri });
      subscription = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) onEnded();
      });
    },
    play() {
      player?.play();
    },
    async stop() {
      player?.pause();
    },
    release() {
      subscription?.remove();
      subscription = null;
      player?.remove();
      player = null;
    },
  };
}

/** The subset of `expo-audio`'s player this backend drives. */
type AudioPlayerInstance = {
  play(): void;
  pause(): void;
  remove(): void;
  addListener(
    event: "playbackStatusUpdate",
    listener: (status: { didJustFinish: boolean }) => void,
  ): { remove(): void };
};
