import { describe, expect, it } from "vitest";
import { catalogs, flattenMessages } from "../index.js";
import type { MessageKey } from "../index.js";

/**
 * item-13 C2b: the RN create-plan Asistente screen
 * (`apps/mobile/src/screens/create-plan/AssistantScreen.tsx`) reuses the
 * item-12 `chat` namespace verbatim (no new namespace) plus the existing
 * `wizard.goal.*`/`wizard.location.*` enum labels for the "Datos extraídos"
 * panel. This guards that EVERY key the mobile screen resolves is present and
 * non-empty in BOTH locales, so the mobile Asistente never renders a raw
 * message id or an empty string in either EN or ES.
 *
 * `satisfies readonly MessageKey[]` makes an accidental typo or a removed key a
 * COMPILE error, not just a runtime miss.
 */
const MOBILE_ASSISTANT_KEYS = [
  // chat thread + input
  "chat.greeting",
  "chat.coachName",
  "chat.coachStatus",
  "chat.streaming",
  "chat.retry",
  "chat.inputPlaceholder",
  "chat.inputAria",
  "chat.send",
  "chat.sendAria",
  "chat.error.chat_stream_timeout",
  "chat.error.chat_stream_failed",
  "chat.error.generic",
  // "Datos extraídos" panel
  "chat.panel.title",
  "chat.panel.editAria",
  "chat.panel.notSet",
  "chat.panel.generate",
  "chat.panel.generateError",
  "chat.field.goal",
  "chat.field.location",
  "chat.field.daysPerWeek",
  "chat.field.sessionDuration",
  "chat.field.equipment",
  "chat.field.limitations",
  "chat.value.equipmentCount",
  "chat.value.limitationsCount",
  // enum labels reused for the goal/location selectors
  "wizard.goal.strength.label",
  "wizard.goal.hypertrophy.label",
  "wizard.goal.fatLoss.label",
  "wizard.goal.generalFitness.label",
  "wizard.location.home.label",
  "wizard.location.gym.label",
  "wizard.location.outdoor.label",
] as const satisfies readonly MessageKey[];

describe("mobile Asistente (C2b) chat-namespace parity", () => {
  const en = flattenMessages(catalogs.en);
  const es = flattenMessages(catalogs.es);

  it.each(MOBILE_ASSISTANT_KEYS)("resolves %s in EN and ES with non-empty copy", (key) => {
    expect(en[key], `${key} missing in en`).toBeTruthy();
    expect(en[key]!.trim().length, `${key} empty in en`).toBeGreaterThan(0);
    expect(es[key], `${key} missing in es`).toBeTruthy();
    expect(es[key]!.trim().length, `${key} empty in es`).toBeGreaterThan(0);
  });
});
