import type { PlanSpecDraft } from "@kinora/contracts";

/**
 * Client-safe SSE event model for the RN Asistente chat stream (item-13 C2a).
 *
 * Ported VERBATIM from the web module
 * (`apps/web/src/app/(app)/create-plan/chat-types.ts`) so the RN reader and web
 * share byte-identical frame semantics. The API (`POST /plan-specs/chat`)
 * streams `text/event-stream` frames:
 *   - repeated `token` deltas (incremental assistant prose)
 *   - exactly ONE terminal `draft` ({ draftSpec, missingFields, assistantMessage })
 *   - or a terminal `error` ({ error: reason }) on failure
 *
 * Deliberately free of any LLM/provider import — the client only sends text and
 * renders the parsed frames (deps-guard: no `openai`/LLM in mobile).
 */
export type ChatSSEEvent =
  | { type: "token"; delta: string }
  | {
      type: "draft";
      draftSpec: PlanSpecDraft;
      missingFields: string[];
      assistantMessage: string;
    }
  | { type: "error"; reason: string };

/** The six wizard INPUT fields a chat turn may extract, plus optional name. */
export type ChatDraftSpec = PlanSpecDraft;
