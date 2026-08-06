import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock `langfuse-langchain` (re-exports the `Langfuse` SDK client) — hoisted
// before any import of production code, no real network, no credentials.
const mockGetPrompt = vi.fn();
const MockLangfuse = vi.fn(() => ({ getPrompt: mockGetPrompt }));
vi.mock("langfuse-langchain", () => ({ Langfuse: MockLangfuse }));

const { buildLangfusePromptGateway, PROMPT_FETCH_TIMEOUT_MS } = await import(
  "../langfuse-prompt-gateway.js"
);
const { PromptNotFoundError } = await import("../prompt-source-port.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildLangfusePromptGateway", () => {
  it("returns null when either credential is missing", () => {
    expect(buildLangfusePromptGateway({ env: {} })).toBeNull();
    expect(buildLangfusePromptGateway({ env: { LANGFUSE_PUBLIC_KEY: "pk" } })).toBeNull();
    expect(buildLangfusePromptGateway({ env: { LANGFUSE_SECRET_KEY: "sk" } })).toBeNull();
  });

  it("constructs the client with the resolved base URL and calls getPrompt with the verified SDK shape", async () => {
    mockGetPrompt.mockResolvedValue({ prompt: "hello {{x}}", version: 7 });
    const gateway = buildLangfusePromptGateway({
      env: {
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
        LANGFUSE_HOST: "https://cloud.example.com",
      },
    });
    expect(gateway).not.toBeNull();

    const result = await gateway!.fetchPrompt("kinora-plan-generation", "production");

    expect(MockLangfuse).toHaveBeenCalledWith(
      expect.objectContaining({
        publicKey: "pk",
        secretKey: "sk",
        baseUrl: "https://cloud.example.com",
      })
    );
    // `version` is the verified 2nd POSITIONAL SDK arg, never an options key.
    expect(mockGetPrompt).toHaveBeenCalledWith(
      "kinora-plan-generation",
      undefined,
      expect.objectContaining({
        label: "production",
        cacheTtlSeconds: 0,
        fetchTimeoutMs: PROMPT_FETCH_TIMEOUT_MS,
      })
    );
    expect(result).toEqual({ template: "hello {{x}}", version: 7 });
  });

  it("omits an explicit baseUrl when neither LANGFUSE_BASEURL nor LANGFUSE_HOST is set", async () => {
    mockGetPrompt.mockResolvedValue({ prompt: "x", version: 1 });
    buildLangfusePromptGateway({ env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" } });

    const [ctorArgs] = MockLangfuse.mock.calls[0] as [Record<string, unknown>];
    expect(ctorArgs).not.toHaveProperty("baseUrl");
  });

  it("normalizes a 404 HTTP fetch error into PromptNotFoundError", async () => {
    const httpError = Object.assign(new Error("not found"), {
      name: "LangfuseFetchHttpError",
      response: { status: 404 },
    });
    mockGetPrompt.mockRejectedValue(httpError);
    const gateway = buildLangfusePromptGateway({
      env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" },
    })!;

    await expect(gateway.fetchPrompt("kinora-chat-reply", "production")).rejects.toBeInstanceOf(
      PromptNotFoundError
    );
  });

  it("rethrows any other fetch failure unchanged (network, auth)", async () => {
    const networkError = Object.assign(new Error("network down"), {
      name: "LangfuseFetchNetworkError",
    });
    mockGetPrompt.mockRejectedValue(networkError);
    const gateway = buildLangfusePromptGateway({
      env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" },
    })!;

    await expect(gateway.fetchPrompt("kinora-chat-extraction", "production")).rejects.toBe(
      networkError
    );
  });
});
