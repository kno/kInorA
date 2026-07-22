import { DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG } from "@kinora/contracts";
import { OpenAIEmbeddings } from "@langchain/openai";

export interface EmbeddingRuntimeConfig {
  provider: string;
  model: string;
  version: string;
  dimension: number;
  timeoutMs: number;
  maxAttempts: number;
}

export interface EmbeddingGenerator {
  config: EmbeddingRuntimeConfig;
  generate(input: string): Promise<number[]>;
}

export type EmbeddingFailureReason =
  | "timeout"
  | "offline"
  | "provider_failure"
  | "misconfigured"
  | "dimension_mismatch";

export type EmbeddingExecutionResult =
  | { kind: "ok"; embedding: number[] }
  | { kind: "failed"; reason: EmbeddingFailureReason };

export const DEFAULT_EMBEDDING_RUNTIME_CONFIG: EmbeddingRuntimeConfig = {
  ...DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG,
  version: DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG.version,
  timeoutMs: 3000,
  maxAttempts: 2,
};

export function validateEmbeddingRuntimeConfig(
  config: EmbeddingRuntimeConfig,
): EmbeddingRuntimeConfig {
  const errors: string[] = [];

  if (!config.provider.trim()) errors.push("provider must be non-blank");
  if (!config.model.trim()) errors.push("model must be non-blank");
  if (!config.version.trim()) errors.push("version must be non-blank");
  if (!Number.isInteger(config.dimension) || config.dimension <= 0) {
    errors.push("dimension must be a positive integer");
  } else if (config.dimension !== DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG.dimension) {
    errors.push(
      `dimension must be ${DEFAULT_VECTOR_MEMORY_EMBEDDING_CONFIG.dimension} for vector memory persistence`,
    );
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    errors.push("timeoutMs must be a positive integer");
  }
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts <= 0) {
    errors.push("maxAttempts must be a positive integer");
  }

  if (errors.length > 0) {
    throw new Error(errors.join(", "));
  }

  return config;
}

export function createOpenAIEmbeddingGenerator(
  runtimeConfig: EmbeddingRuntimeConfig = DEFAULT_EMBEDDING_RUNTIME_CONFIG,
  env: NodeJS.ProcessEnv = process.env,
): EmbeddingGenerator {
  const config = validateEmbeddingRuntimeConfig(runtimeConfig);
  if (config.provider !== "openai") {
    throw new Error(`Unsupported embedding provider: ${config.provider}`);
  }

  const embeddings = new OpenAIEmbeddings({
    apiKey: env["OPENAI_API_KEY"] ?? "placeholder-key",
    model: config.model,
    dimensions: config.dimension,
  });

  return {
    config,
    generate(input: string): Promise<number[]> {
      return embeddings.embedQuery(input);
    },
  };
}

export async function generateEmbeddingWithPolicy(
  generator: EmbeddingGenerator,
  input: string,
  overrides: Partial<Pick<EmbeddingRuntimeConfig, "timeoutMs" | "maxAttempts">> = {},
): Promise<EmbeddingExecutionResult> {
  const config = validateEmbeddingRuntimeConfig({
    ...generator.config,
    ...overrides,
  });

  let failure: EmbeddingFailureReason = "provider_failure";

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      const embedding = await withTimeout(generator.generate(input), config.timeoutMs);
      if (embedding.length !== config.dimension) {
        return { kind: "failed", reason: "dimension_mismatch" };
      }
      return { kind: "ok", embedding };
    } catch (error) {
      failure = classifyEmbeddingError(error);
      if (!isRetryableFailure(failure) || attempt >= config.maxAttempts) {
        return { kind: "failed", reason: failure };
      }
    }
  }

  return { kind: "failed", reason: failure };
}

function isRetryableFailure(reason: EmbeddingFailureReason): boolean {
  return reason === "timeout" || reason === "offline" || reason === "provider_failure";
}

function classifyEmbeddingError(error: unknown): EmbeddingFailureReason {
  if (error instanceof Error && error.name === "TimeoutError") {
    return "timeout";
  }

  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    message.includes("offline") ||
    message.includes("network") ||
    message.includes("econnrefused")
  ) {
    return "offline";
  }

  if (
    message.includes("config") ||
    message.includes("api key") ||
    message.includes("unsupported")
  ) {
    return "misconfigured";
  }

  return "provider_failure";
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(`Embedding generation timed out after ${timeoutMs}ms`);
          error.name = "TimeoutError";
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
