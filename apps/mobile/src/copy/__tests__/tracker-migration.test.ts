/**
 * Slice 10, Phase 10.1.1 — proves every old `copy/tracker.ts` entry (the
 * pre-migration hardcoded-Spanish functions, deleted in 10.1.4) has an ICU
 * catalog equivalent that renders IDENTICAL output for representative
 * inputs. The `es` expectations below are the literal historical strings
 * `copy/tracker.ts` used to hardcode — baked in directly (not imported from
 * the now-deleted module) so this stays a permanent regression lock rather
 * than a transient migration-day proof.
 *
 * The app had NO English copy before this slice — so "identical to the old
 * copy" only applies to `es`. The `en` assertions are the NEW capability
 * this slice unlocks: a real, non-placeholder English translation for the
 * same key, pinned against the catalog's authored EN text.
 *
 * 22 of the 45 entries reuse an existing web `tracker.*` key verbatim
 * (byte-identical ES text, authored pre-existing); the other 23 reuse the
 * `mobileTracker.*` namespace authored in slice 9 (9.3).
 */
import { createIntl } from "react-intl";
import { catalogs, flattenMessages } from "@kinora/i18n";
import { describe, expect, it } from "vitest";

function render(
  locale: "en" | "es",
  id: string,
  values?: Record<string, string | number>,
) {
  const intl = createIntl({ locale, messages: flattenMessages(catalogs[locale]) });
  return intl.formatMessage({ id }, values);
}

describe("tracker copy → ICU catalog parity", () => {
  it("es: plain strings render BYTE-IDENTICAL to the old hardcoded copy", () => {
    expect(render("es", "tracker.live.eyebrow")).toBe("Sesión activa");
    expect(render("es", "tracker.timerLabel")).toBe("Tiempo");
    expect(render("es", "tracker.pauseLabel")).toBe("Pausar sesión");
    expect(render("es", "tracker.resumeLabel")).toBe("Reanudar sesión");
    expect(render("es", "tracker.currentExercise")).toBe("Ejercicio actual");
    expect(render("es", "tracker.load.label")).toBe("Carga");
    expect(render("es", "tracker.unit.kg")).toBe("kg");
    expect(render("es", "tracker.reps.label")).toBe("Reps");
    expect(render("es", "tracker.unit.reps")).toBe("reps");
    expect(render("es", "tracker.weight.downLabel")).toBe("Reducir carga 2.5 kg");
    expect(render("es", "tracker.weight.upLabel")).toBe("Aumentar carga 2.5 kg");
    expect(render("es", "mobileTracker.reps.decrease")).toBe("Reducir repetición");
    expect(render("es", "mobileTracker.reps.increase")).toBe("Aumentar repetición");
    expect(render("es", "tracker.completeSet.cta")).toBe("Completar serie");
    expect(render("es", "tracker.rest.active")).toBe("Descanso activo");
    expect(render("es", "tracker.rest.label")).toBe("descanso");
    expect(render("es", "tracker.rest.addTime")).toBe("+15 s");
    expect(render("es", "tracker.rest.addLabel")).toBe("Agregar 15 segundos");
    expect(render("es", "tracker.rest.skip")).toBe("Saltar");
    expect(render("es", "tracker.rest.skipLabel")).toBe("Saltar descanso");
    expect(render("es", "tracker.rest.aria")).toBe("Temporizador de descanso");
    expect(render("es", "tracker.next.heading")).toBe("A continuación");
    expect(render("es", "mobileTracker.finish.cta")).toBe("Finalizar sesión");
    expect(render("es", "mobileTracker.finish.a11y")).toBe("Finalizar sesión de entrenamiento");
    expect(render("es", "mobileTracker.loading")).toBe("Cargando sesión…");
    expect(render("es", "mobileTracker.complete.title")).toBe("Sesión completada");
    expect(render("es", "mobileTracker.complete.body")).toBe(
      "¡Buen trabajo! Registramos tu entrenamiento.",
    );
    expect(render("es", "mobileTracker.backHome")).toBe("Volver al inicio");
    expect(render("es", "mobileTracker.conflict.generic")).toBe(
      "Ya tenés una sesión activa. Terminala antes de empezar otra.",
    );
    expect(render("es", "mobileTracker.error.start")).toBe(
      "No pudimos iniciar la sesión. Intentá de nuevo.",
    );
    expect(render("es", "mobileTracker.error.load")).toBe(
      "No pudimos cargar la sesión. Intentá de nuevo.",
    );
    expect(render("es", "mobileTracker.error.record")).toBe(
      "No pudimos guardar la serie. Intentá de nuevo.",
    );
    expect(render("es", "mobileTracker.error.complete")).toBe(
      "No pudimos finalizar la sesión. Intentá de nuevo.",
    );
    expect(render("es", "mobileTracker.retry")).toBe("Reintentar");
  });

  it("es: interpolated strings render BYTE-IDENTICAL to the old hardcoded copy", () => {
    expect(render("es", "tracker.progress.label", { n: 2, m: 6 })).toBe("Ejercicio 2 de 6");
    expect(render("es", "mobileTracker.progress.a11y", { current: 2, total: 6 })).toBe(
      "2 de 6 ejercicios",
    );
    expect(render("es", "tracker.progress.valuetext", { n: 2, m: 6, percent: 33 })).toBe(
      "Ejercicio 2 de 6, 33%",
    );
    expect(
      render("es", "mobileTracker.set.info", {
        setNumber: 1,
        setTotal: 3,
        targetLabel: "40 kg × 8 reps",
      }),
    ).toBe("Serie 1 de 3 · Objetivo: 40 kg × 8 reps");
    expect(render("es", "mobileTracker.objective.withWeight", { weightKg: 40, reps: "8" })).toBe(
      "40 kg × 8 reps",
    );
    expect(render("es", "mobileTracker.objective.noWeight", { reps: "12" })).toBe("12 reps");
    expect(render("es", "mobileTracker.completeSet.a11y", { setNumber: 2 })).toBe(
      "Completar serie 2",
    );
    expect(render("es", "mobileTracker.next.detail", { sets: 3, weightKg: 60, reps: "5" })).toBe(
      "3 series · 60 kg × 5 reps",
    );
    expect(render("es", "mobileTracker.next.detailNoWeight", { sets: 3, reps: "12" })).toBe(
      "3 series · 12 reps",
    );
    expect(render("es", "mobileTracker.conflict.withScope", { planName: "Fuerza", day: 3 })).toBe(
      "Ya tenés una sesión activa en «Fuerza» (Día 3). Terminala antes de empezar otra.",
    );
    expect(render("es", "mobileTracker.conflict.withPlan", { planName: "Fuerza" })).toBe(
      "Ya tenés una sesión activa en «Fuerza». Terminala antes de empezar otra.",
    );
  });

  it("en: the same keys render real, non-empty English text (new capability, pinned to the catalog)", () => {
    expect(render("en", "tracker.live.eyebrow")).toBe("Active session");
    expect(render("en", "tracker.timerLabel")).toBe("Time");
    expect(render("en", "tracker.pauseLabel")).toBe("Pause session");
    expect(render("en", "tracker.completeSet.cta")).toBe("Complete set");
    expect(render("en", "tracker.rest.active")).toBe("Rest active");
    expect(render("en", "mobileTracker.finish.cta")).toBe("Finish session");
    expect(render("en", "mobileTracker.loading")).toBe("Loading session…");
    expect(render("en", "mobileTracker.complete.title")).toBe("Session completed");
    expect(render("en", "mobileTracker.backHome")).toBe("Back to home");
    expect(render("en", "mobileTracker.retry")).toBe("Retry");
    expect(render("en", "tracker.progress.label", { n: 2, m: 6 })).toBe("Exercise 2 of 6");
    expect(
      render("en", "mobileTracker.objective.withWeight", { weightKg: 40, reps: "8" }),
    ).toBe("40 kg × 8 reps");
    expect(
      render("en", "mobileTracker.conflict.withScope", { planName: "Fuerza", day: 3 }),
    ).toBe(
      'You already have an active session in "Fuerza" (Day 3). Finish it before starting another.',
    );
  });
});
