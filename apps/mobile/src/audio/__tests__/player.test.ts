import { describe, expect, it, vi } from "vitest";
import { createPlayer, type AudioPlayerBackend } from "../player";

/** A fake native backend capturing the loaded source + the ended callback. */
function fakeBackend(overrides: Partial<AudioPlayerBackend> = {}) {
  let onEnded: () => void = () => {};
  const backend: AudioPlayerBackend = {
    load: vi.fn(async (_uri: string, cb: () => void) => {
      onEnded = cb;
    }),
    play: vi.fn(),
    stop: vi.fn(async () => {}),
    release: vi.fn(),
    ...overrides,
  };
  return { backend, fireEnded: () => onEnded() };
}

const MP3 = new Uint8Array([0xff, 0xf3, 0x01, 0x02, 0x03]);

describe("createPlayer (D2 native TTS playback)", () => {
  it("plays mp3 bytes as a data: URI through the backend", async () => {
    const { backend } = fakeBackend();
    const player = createPlayer(async () => backend);

    await player.play({ bytes: MP3, contentType: "audio/mpeg" });

    expect(backend.load).toHaveBeenCalledTimes(1);
    const [uri] = (backend.load as any).mock.calls[0];
    expect(uri).toMatch(/^data:audio\/mpeg;base64,/);
    expect(backend.play).toHaveBeenCalledTimes(1);
  });

  it("plays a plain URI source unchanged", async () => {
    const { backend } = fakeBackend();
    const player = createPlayer(async () => backend);

    await player.play({ uri: "file:///reply.mp3" });

    expect((backend.load as any).mock.calls[0][0]).toBe("file:///reply.mp3");
    expect(backend.play).toHaveBeenCalledTimes(1);
  });

  it("stops any current playback before starting a new one (no overlap)", async () => {
    const first = fakeBackend();
    const second = fakeBackend();
    const factory = vi
      .fn<() => Promise<AudioPlayerBackend>>()
      .mockResolvedValueOnce(first.backend)
      .mockResolvedValueOnce(second.backend);
    const player = createPlayer(factory);

    await player.play({ uri: "a.mp3" });
    await player.play({ uri: "b.mp3" });

    // The first backend was stopped + released before the second played.
    expect(first.backend.stop).toHaveBeenCalledTimes(1);
    expect(first.backend.release).toHaveBeenCalledTimes(1);
    expect(second.backend.play).toHaveBeenCalledTimes(1);
  });

  it("stop() stops and releases the native resources", async () => {
    const { backend } = fakeBackend();
    const player = createPlayer(async () => backend);

    await player.play({ uri: "a.mp3" });
    await player.stop();

    expect(backend.stop).toHaveBeenCalledTimes(1);
    expect(backend.release).toHaveBeenCalledTimes(1);
  });

  it("stop() is safe when nothing is playing", async () => {
    const { backend } = fakeBackend();
    const player = createPlayer(async () => backend);
    await expect(player.stop()).resolves.toBeUndefined();
    expect(backend.stop).not.toHaveBeenCalled();
  });

  it("releases the backend and notifies the caller when playback finishes", async () => {
    const { backend, fireEnded } = fakeBackend();
    const player = createPlayer(async () => backend);
    const onEnded = vi.fn();

    await player.play({ uri: "a.mp3" }, onEnded);
    fireEnded();

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(backend.release).toHaveBeenCalledTimes(1);
  });

  it("release() tears down the native backend (idempotent)", async () => {
    const { backend } = fakeBackend();
    const player = createPlayer(async () => backend);
    await player.play({ uri: "a.mp3" });

    player.release();
    player.release();

    expect(backend.release).toHaveBeenCalledTimes(1);
  });
});
