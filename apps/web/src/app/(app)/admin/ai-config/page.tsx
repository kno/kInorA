import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/auth/session-cookie";
import { fetchAiConfig } from "./ai-config-client";
import { AiConfigForm } from "./AiConfigForm";
import type { AiProvider } from "./ai-config-client";

/**
 * AI Provider Admin Config page — /admin/ai-config
 *
 * Server component that:
 *  1. Reads the session token from the kinora_session cookie
 *  2. Fetches the current AI provider config from GET /admin/ai-config
 *  3. If the API returns 403 (not admin) → redirect to /  (SC-13, T9)
 *  4. Renders AiConfigForm with the current config (SC-14)
 *
 * API keys are NEVER shown in this panel — only provider + model.
 */
export default async function AiConfigPage() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  const result = await fetchAiConfig(token);

  // SC-13 / T9: non-admin (403) OR unauthenticated (401) → redirect to home.
  // Never render the admin panel UI to a user the API would not authorize.
  if (result.kind === "forbidden" || result.kind === "unauthorized") {
    redirect("/");
  }

  const config = result.kind === "ok" ? result.config : null;

  return (
    <main className="kin-page">
      <div className="kin-card kin-card--center">
        <h1 className="kin-title">AI Provider Settings</h1>
        <p className="kin-text kin-muted" style={{ marginBottom: "1.5rem" }}>
          Select the active AI provider and model for plan generation.
          API keys are managed via server environment variables — not here.
        </p>
        <AiConfigForm
          initialProvider={config?.provider as AiProvider | undefined}
          initialModel={config?.model}
        />
      </div>
    </main>
  );
}
