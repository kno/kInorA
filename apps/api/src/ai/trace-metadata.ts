/**
 * The COMPLETE set of keys permitted on a Langfuse trace's `metadata`
 * (17c-profile-body-metrics, PR 3).
 *
 * Closed on purpose: the SDK's `mask` hook (`trace-redaction.ts`) covers
 * `input`/`output` ONLY — never `metadata` (verified in the installed
 * `langfuse-core` package). Metadata is therefore the one payload no
 * redaction rule can rescue, and `ObservabilityMetadata`-style flat scalar
 * bags let a body value like `weightKg: 68` compile without complaint.
 *
 * Annotating the trace-metadata object literal at each call site with this
 * type turns "never put a body value in metadata" from a review discipline
 * into a compile error: adding a key here is a deliberate act with a
 * reviewer attached; adding one at a call site is not.
 */
export interface PlanTraceMetadata {
  feature: "plan-generation" | "plan-chat-extraction";
  provider: string;
  model: string;
  promptSource: "langfuse" | "fallback";
  promptLinked: boolean;
  promptName?: string;
  promptVersion?: number;
  promptLabel?: "production";
  langfusePrompt?: { name?: string; version?: number; isFallback: boolean };
}
