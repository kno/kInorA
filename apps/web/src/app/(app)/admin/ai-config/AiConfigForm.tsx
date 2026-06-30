"use client";

import { useState } from "react";
import {
  MODEL_DEFAULTS,
  VALID_PROVIDERS,
  type AiProvider,
} from "./ai-config-client";
import { updateAiConfigAction } from "./actions";

export interface AiConfigFormProps {
  initialProvider?: AiProvider;
  initialModel?: string;
}

/**
 * AiConfigForm — client component for the AI provider admin panel.
 *
 * Renders a provider select and a model text input. On submit it invokes the
 * `updateAiConfigAction` server action (which proxies to PUT /admin/ai-config
 * server-to-server) and shows a success or error message. The browser never
 * calls the API directly, and the session token never reaches client JS.
 *
 * SC-14: admin user sees current config (passed as props from server component)
 * SC-15: submit → calls PUT, shows confirmation
 */
export function AiConfigForm({ initialProvider, initialModel }: AiConfigFormProps) {
  const defaultProvider: AiProvider = initialProvider ?? "openrouter";
  const defaultModel = initialModel ?? MODEL_DEFAULTS[defaultProvider];

  const [provider, setProvider] = useState<AiProvider>(defaultProvider);
  const [model, setModel] = useState<string>(defaultModel);
  const [status, setStatus] = useState<"idle" | "loading" | "saved" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");

  function handleProviderChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as AiProvider;
    setProvider(next);
    setModel(MODEL_DEFAULTS[next]);
    setStatus("idle");
  }

  function handleModelChange(e: React.ChangeEvent<HTMLInputElement>) {
    setModel(e.target.value);
    setStatus("idle");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    const result = await updateAiConfigAction(provider, model);

    if (result.kind === "ok") {
      setStatus("saved");
    } else {
      setStatus("error");
      setErrorMessage(result.kind === "forbidden" ? "Access denied." : "An error occurred. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="kin-card" style={{ maxWidth: 480 }}>
      <h2 className="kin-title" style={{ fontSize: "1.125rem", marginBottom: "1rem" }}>
        AI Provider Configuration
      </h2>

      <div style={{ marginBottom: "1rem" }}>
        <label htmlFor="provider" style={{ display: "block", marginBottom: "0.25rem" }}>
          Provider
        </label>
        <select
          id="provider"
          value={provider}
          onChange={handleProviderChange}
          className="kin-input"
          style={{ width: "100%" }}
        >
          {VALID_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <label htmlFor="model" style={{ display: "block", marginBottom: "0.25rem" }}>
          Model
        </label>
        <input
          id="model"
          type="text"
          value={model}
          onChange={handleModelChange}
          className="kin-input"
          style={{ width: "100%" }}
          placeholder="e.g. gpt-4o-mini"
        />
      </div>

      <button
        type="submit"
        disabled={status === "loading"}
        className="kin-btn kin-btn--primary"
      >
        {status === "loading" ? "Saving..." : "Save"}
      </button>

      {status === "saved" && (
        <p style={{ marginTop: "0.75rem", color: "green" }}>
          Configuration saved successfully.
        </p>
      )}

      {status === "error" && (
        <p style={{ marginTop: "0.75rem", color: "red" }}>
          error: {errorMessage}
        </p>
      )}
    </form>
  );
}
