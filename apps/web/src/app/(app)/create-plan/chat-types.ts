import type { PlanSpecDraft } from "@kinora/contracts";

/**
 * Client-safe SSE event model for the Asistente chat stream (12 Slice 3).
 *
 * The API (`POST /plan-specs/chat`) streams `text/event-stream` frames:
 *   - repeated `token` deltas (incremental assistant prose)
 *   - exactly ONE terminal `draft` ({ draftSpec, missingFields, assistantMessage })
 *   - or a terminal `error` ({ error: reason }) on failure
 *
 * This module is deliberately free of any LLM/provider import — the browser
 * only sends text and renders the parsed frames (deps-guard: no
 * `langchain`/`openai`/`langfuse`/`ai-sdk` in web).
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
