import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock langfuse-langchain — hoisted before any import of production code.
// No real client, no network, no credentials. The mock constructor is
// swapped per-test to simulate a throwing construction path.
// ---------------------------------------------------------------------------
const mockCallbackHandlerCtor = vi.fn();
vi.mock("langfuse-langchain", () => ({
  CallbackHandler: mockCallbackHandlerCtor,
}));

const { buildLangfuseCallbackHandler, resolveLangfuseBaseUrl, flushLangfuseHandlerOnClose } =
  await import("../langfuse-handler.js");
const { redactTracedPayload } = await import("../trace-redaction.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockCallbackHandlerCtor.mockImplementation(() => ({
    name: "langfuse",
    flushAsync: vi.fn().mockResolvedValue(undefined),
  }));
});

describe("buildLangfuseCallbackHandler — credential gate", () => {
  it("returns null when LANGFUSE_PUBLIC_KEY is missing", () => {
    const handler = buildLangfuseCallbackHandler({
      env: { LANGFUSE_SECRET_KEY: "sk-test" },
    });
    expect(handler).toBeNull();
    expect(mockCallbackHandlerCtor).not.toHaveBeenCalled();
  });

  it("returns null when LANGFUSE_SECRET_KEY is missing", () => {
    const handler = buildLangfuseCallbackHandler({
      env: { LANGFUSE_PUBLIC_KEY: "pk-test" },
    });
    expect(handler).toBeNull();
    expect(mockCallbackHandlerCtor).not.toHaveBeenCalled();
  });

  it("returns null when both keys are missing", () => {
    const handler = buildLangfuseCallbackHandler({ env: {} });
    expect(handler).toBeNull();
    expect(mockCallbackHandlerCtor).not.toHaveBeenCalled();
  });

  it("constructs a handler when both keys are present", () => {
    const handler = buildLangfuseCallbackHandler({
      env: { LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "sk-test" },
    });
    expect(handler).not.toBeNull();
    expect(mockCallbackHandlerCtor).toHaveBeenCalledTimes(1);
  });
});

describe("buildLangfuseCallbackHandler — trace redaction wiring (17c-profile-body-metrics, PR 3)", () => {
  it("passes the general redaction function as the mask option on every construction", () => {
    buildLangfuseCallbackHandler({
      env: { LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "sk-test" },
    });
    expect(mockCallbackHandlerCtor).toHaveBeenCalledWith(
      expect.objectContaining({ mask: redactTracedPayload }),
    );
  });

  it("keeps the mask option alongside baseUrl and credentials — none is dropped by the other", () => {
    buildLangfuseCallbackHandler({
      env: {
        LANGFUSE_PUBLIC_KEY: "pk-test",
        LANGFUSE_SECRET_KEY: "sk-test",
        LANGFUSE_HOST: "https://host.example.com",
      },
    });
    const [params] = mockCallbackHandlerCtor.mock.calls[0] as [Record<string, unknown>];
    expect(params).toEqual(
      expect.objectContaining({
        publicKey: "pk-test",
        secretKey: "sk-test",
        baseUrl: "https://host.example.com",
        mask: redactTracedPayload,
      }),
    );
  });
});

describe("buildLangfuseCallbackHandler — construction failure", () => {
  it("returns null (+ exactly one warn call) when construction throws", () => {
    mockCallbackHandlerCtor.mockImplementation(() => {
      throw new Error("boom");
    });
    const warn = vi.fn();
    const handler = buildLangfuseCallbackHandler({
      env: { LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "sk-test" },
      warn,
    });
    expect(handler).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    // Never a credential in the warn payload.
    expect(warn.mock.calls[0]?.[0]).not.toContain("pk-test");
    expect(warn.mock.calls[0]?.[0]).not.toContain("sk-test");
  });
});

describe("resolveLangfuseBaseUrl — precedence", () => {
  it("uses LANGFUSE_HOST when only it is set (current production shape)", () => {
    expect(
      resolveLangfuseBaseUrl({ LANGFUSE_HOST: "https://host.example.com" })
    ).toBe("https://host.example.com");
  });

  it("prefers LANGFUSE_BASEURL when both are set", () => {
    expect(
      resolveLangfuseBaseUrl({
        LANGFUSE_BASEURL: "https://baseurl.example.com",
        LANGFUSE_HOST: "https://host.example.com",
      })
    ).toBe("https://baseurl.example.com");
  });

  it("returns undefined when neither is set", () => {
    expect(resolveLangfuseBaseUrl({})).toBeUndefined();
  });
});

describe("buildLangfuseCallbackHandler — baseUrl wiring", () => {
  it("passes the resolved baseUrl to the constructor", () => {
    buildLangfuseCallbackHandler({
      env: {
        LANGFUSE_PUBLIC_KEY: "pk-test",
        LANGFUSE_SECRET_KEY: "sk-test",
        LANGFUSE_HOST: "https://host.example.com",
      },
    });
    expect(mockCallbackHandlerCtor).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://host.example.com" })
    );
  });

  it("passes no explicit baseUrl key when neither env var is set", () => {
    buildLangfuseCallbackHandler({
      env: { LANGFUSE_PUBLIC_KEY: "pk-test", LANGFUSE_SECRET_KEY: "sk-test" },
    });
    const [params] = mockCallbackHandlerCtor.mock.calls[0] as [Record<string, unknown>];
    expect(params).not.toHaveProperty("baseUrl");
  });
});

describe("flushLangfuseHandlerOnClose", () => {
  it("swallows a flushAsync rejection and warns with errName only (no secrets)", async () => {
    const handler = {
      name: "fake",
      flushAsync: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const warn = vi.fn();

    await expect(flushLangfuseHandlerOnClose(handler, warn)).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    const [payload, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(Object.keys(payload)).toEqual(["errName"]);
    expect(typeof payload["errName"]).toBe("string");
    expect(payload).not.toHaveProperty("message");
    expect(payload).not.toHaveProperty("stack");
    expect(message).toBe("[langfuse-handler] flushAsync failed on shutdown");
  });

  it("resolves without warning when flushAsync succeeds", async () => {
    const handler = {
      name: "fake",
      flushAsync: vi.fn().mockResolvedValue(undefined),
    };
    const warn = vi.fn();

    await expect(flushLangfuseHandlerOnClose(handler, warn)).resolves.toBeUndefined();

    expect(handler.flushAsync).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("no-ops when handler is null", async () => {
    const warn = vi.fn();

    await expect(flushLangfuseHandlerOnClose(null, warn)).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
  });
});
