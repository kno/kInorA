import { Langfuse } from "langfuse-langchain";
import { resolveLangfuseBaseUrl } from "./langfuse-handler.js";
import { PromptNotFoundError, type LangfusePromptGateway } from "./prompt-source-port.js";

/**
 * SDK adapter over `Langfuse.getPrompt` (langfuse-prompt-management, slice
 * B2). `Langfuse` is re-exported by `langfuse-langchain`, so no new
 * dependency is added.
 *
 * `cacheTtlSeconds: 0` forces a live fetch on every call and — with no
 * `fallback` option supplied — makes the SDK RE-THROW on failure, so the
 * repo-owned TTL cache in `ResolvePrompt` (`prompt-provider.ts`) is the ONLY
 * cache, and every failure class reaches this adapter's caller instead of
 * being silently absorbed by the SDK.
 */
export const PROMPT_FETCH_TIMEOUT_MS = 3000;

class LangfuseSdkPromptGateway implements LangfusePromptGateway {
  constructor(private readonly client: InstanceType<typeof Langfuse>) {}

  async fetchPrompt(name: string, label: string): Promise<{ template: unknown; version: number }> {
    let response: { prompt: unknown; version: number };
    try {
      response = await this.client.getPrompt(name, undefined, {
        label,
        cacheTtlSeconds: 0,
        fetchTimeoutMs: PROMPT_FETCH_TIMEOUT_MS,
      });
    } catch (error) {
      // A 404 HTTP status means no prompt is registered under this
      // name/label — distinguished from a generic transport/auth failure so
      // `ResolvePrompt` can assign the more specific `prompt_not_found`
      // reason code. Every other failure (network, auth, 5xx) is rethrown
      // unchanged and mapped to the catch-all `fetch_failed`.
      const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
      if (status === 404) {
        throw new PromptNotFoundError(name);
      }
      throw error;
    }
    return { template: response.prompt, version: response.version };
  }
}

/**
 * Builds a `LangfusePromptGateway`, or `null` when either Langfuse credential
 * is absent — the safe-by-construction pattern `buildLangfuseCallbackHandler`
 * (`langfuse-handler.ts`) already established. `null` here means
 * `ResolvePrompt` never attempts a remote fetch and serves the local template
 * with reason `no_credentials`.
 */
export function buildLangfusePromptGateway(opts?: {
  env?: Record<string, string | undefined>;
}): LangfusePromptGateway | null {
  const env = opts?.env ?? process.env;
  const publicKey = env["LANGFUSE_PUBLIC_KEY"];
  const secretKey = env["LANGFUSE_SECRET_KEY"];
  if (!publicKey || !secretKey) {
    return null;
  }

  const baseUrl = resolveLangfuseBaseUrl(env);
  const client = new Langfuse({
    publicKey,
    secretKey,
    ...(baseUrl ? { baseUrl } : {}),
  });
  return new LangfuseSdkPromptGateway(client);
}
