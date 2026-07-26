import { describe, expect, it, vi } from "vitest";
import { createRecorder, type AudioBackend } from "../recorder";

/**
 * A structural fake `AudioBackend` (item-13 D1). The recorder is injected with
 * this so the suite never touches `expo-audio`, a device, or the network —
 * exactly the seam `session-storage`/`plan-draft-client` use for SecureStore.
 */
function fakeBackend(overrides: Partial<AudioBackend> = {}): AudioBackend {
  return {
    requestPermission: vi.fn(async () => true),
    prepare: vi.fn(async () => {}),
    start: vi.fn(() => {}),
    stop: vi.fn(async () => {}),
    getUri: vi.fn(() => "file:///tmp/recording.m4a"),
    release: vi.fn(() => {}),
    ...overrides,
  };
}

describe("createRecorder (D1 Expo mic capture)", () => {
  it("grants permission then records to an .m4a file URI", async () => {
    const backend = fakeBackend();
    const recorder = createRecorder(async () => backend);

    expect(await recorder.requestPermission()).toBe("granted");

    await recorder.start();
    expect(backend.prepare).toHaveBeenCalledTimes(1);
    expect(backend.start).toHaveBeenCalledTimes(1);

    const result = await recorder.stop();
    expect(backend.stop).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      uri: "file:///tmp/recording.m4a",
      contentType: "audio/m4a",
      fileName: "audio.m4a",
    });
  });

  it("returns a graceful 'denied' signal when permission is blocked — no throw", async () => {
    const backend = fakeBackend({ requestPermission: vi.fn(async () => false) });
    const recorder = createRecorder(async () => backend);

    await expect(recorder.requestPermission()).resolves.toBe("denied");
    // Denial must never prepare or start the native recorder.
    expect(backend.prepare).not.toHaveBeenCalled();
    expect(backend.start).not.toHaveBeenCalled();
  });

  it("stop without an active recording resolves null (no crash)", async () => {
    const backend = fakeBackend();
    const recorder = createRecorder(async () => backend);

    await expect(recorder.stop()).resolves.toBeNull();
    expect(backend.stop).not.toHaveBeenCalled();
  });

  it("resolves null when the backend produced no URI", async () => {
    const backend = fakeBackend({ getUri: vi.fn(() => null) });
    const recorder = createRecorder(async () => backend);

    await recorder.start();
    await expect(recorder.stop()).resolves.toBeNull();
  });

  it("release tears down the backend and blocks a stale stop", async () => {
    const backend = fakeBackend();
    const recorder = createRecorder(async () => backend);

    await recorder.start();
    recorder.release();
    expect(backend.release).toHaveBeenCalledTimes(1);
    // A stop after release must not touch the released backend.
    await expect(recorder.stop()).resolves.toBeNull();
    expect(backend.stop).not.toHaveBeenCalled();
  });
});
