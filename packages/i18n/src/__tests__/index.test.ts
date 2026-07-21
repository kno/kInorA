import { describe, expect, it } from "vitest";
import { catalogs, flattenMessages, mergeWithBase, validateCatalogParity } from "../index.js";
import type { MessageKey } from "../index.js";

const PROFILE_AND_PREFERENCES_KEYS = [
  "profile.title",
  "profile.description",
  "profile.form.heading",
  "profile.form.name",
  "profile.form.namePlaceholder",
  "profile.form.goal",
  "profile.form.experience",
  "profile.form.goalPlaceholder",
  "profile.form.experiencePlaceholder",
  "profile.form.save",
  "profile.form.saving",
  "profile.form.saved",
  "profile.form.error",
  "profile.form.loadError",
  "profile.form.nameRequired",
  "profile.experience.beginner",
  "profile.experience.intermediate",
  "profile.experience.advanced",
  "wizard.step.preferencesTitle",
  "wizard.preferences.locationLabel",
  "wizard.preferences.durationLabel",
  "wizard.preferences.equipmentLabel",
  "wizard.preferences.saveError",
] as const satisfies readonly MessageKey[];

function extractPlaceholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([\w]+)[^}]*\}/g)]
    .map(([, name]) => name)
    .filter((name): name is string => Boolean(name))
    .sort();
}

// Type-level: `MessageKey` must derive from the REAL shipped catalog shape
// (329 leaf keys — 325 migrated + 3 `plan.error.*` keys promoted in slice 5
// from PlanStatusView's inline WS-lost "error"-state fallback strings, + 1
// `tracker.error.generic` key promoted from PlanTrackerClient/PlanStatusClient's
// inline unknown-error-code fallback) without any manual enumeration — an
// unknown key must fail to type-check, and a real migrated key must
// type-check.
const realKey: MessageKey = "nav.login";
type IsUnknownRealKeyRejected = Extract<"nav.doesNotExist", MessageKey> extends never ? true : false;
const unknownRealKeyRejected: IsUnknownRealKeyRejected = true;

describe("@kinora/i18n package assembly", () => {
  it("exports the full en/es catalogs", () => {
    expect(catalogs.en).toBeDefined();
    expect(catalogs.es).toBeDefined();
  });

  it("the full catalogs pass the parity/ICU-arg guard", () => {
    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("the full catalog carries all 430 migrated leaf keys per locale", () => {
    // 329 web-migrated keys + 23 `mobileTracker.*` keys authored in slice 9
    // for the mobile-unique tracker copy that has no EN/web equivalent (see
    // 9.3.1 enumeration in tasks.md) + 10 `history.*` keys authored in 09b
    // Phase 3 (Session History) for the web/mobile history surfaces + 3
    // `tracker.sync.*` keys authored in 09b Phase 4 (Web Offline) for the
    // stale-Server-Action "reload to sync" prompt (`reload_required`), the
    // Judgment Day PR4 fixes' session-expired-mid-flush prompt
    // (`auth_required`), and the poison-drop-must-surface prompt (`dropped`)
    // + 15 `dashboard.*` keys authored in 09c-v1-progress-dashboard-stats
    // Slice 2 for the data-backed dashboard (hero, streak, weekly progress,
    // week-route strip, empty state) + 17 `stats.*` keys authored in
    // 09c-v1-progress-dashboard-stats Slice 3a for the KPI cards, period
    // toggle, volume trend, and the Slice-3b "coming soon" placeholders
    // + 6 `stats.*` keys authored in Slice 3b for the real distribution/PR
    // empty states and PR table headers + 12 `progress.muscle.<slug>` keys
    // authored in Slice 3b (10 primary `MuscleGroup` labels + 2 composite
    // "legs"/"arms" presentation labels for the web-only coarse collapse)
    // + 6 `plan.week.*` keys authored in Slice 4a (weekly board visual
    // realignment, closes #128) for the board header eyebrow/title and the
    // inert (disabled) week-nav's aria-labels + static week label
    // + 4 `plan.dayState.*` keys and 5 `exercises.history.*` keys authored
    // in Slice 4b for the real done/active/rest/soon day-state labels and
    // the read-only exercise-history section.
    // + 44 `dashboard.*` keys added when the web dashboard was realigned to
    // the full web-dashboard.html mockup (topbar, hero session copy + stats,
    // readiness ring, streak chip, Coach AI card, next-session card, and the
    // "Bloque de hoy" exercise list — presentational modules included).
    // + 68 `plan.*` keys added when the web plan page was realigned to the
    // full web-plan.html mockup (25 `plan.hero.*` topbar/hero cockpit copy +
    // metrics/body-map, 11 `plan.readiness.*`, 22 `plan.today.*` side-rail
    // exercise blocks, 10 `plan.coach.*` — the side rail is presentational).
    // + 15 `profile.*` keys authored in 10a Slice 4 for the /profile form
    // (12 `profile.form.*` heading/labels/placeholders/feedback + 3
    // `profile.experience.*` level labels; goal select reuses wizard.goal.*)
    // + 5 `wizard.preferences.*` keys authored in 10a Slice 5 for the
    // defaults step title/labels and preferences-save error feedback.
    const flat = flattenMessages(catalogs.en);
    expect(Object.keys(flat)).toHaveLength(567);
  });

  it("ships the accepted profile + wizard preference keys in both catalogs", () => {
    const en = flattenMessages(catalogs.en);
    const es = flattenMessages(catalogs.es);

    for (const key of PROFILE_AND_PREFERENCES_KEYS) {
      expect(en[key]).toBeTypeOf("string");
      expect(es[key]).toBeTypeOf("string");
    }
  });

  it("keeps placeholder parity for the accepted profile + wizard preference keys", () => {
    const en = flattenMessages(catalogs.en);
    const es = flattenMessages(catalogs.es);

    for (const key of PROFILE_AND_PREFERENCES_KEYS) {
      expect(extractPlaceholders(en[key]!)).toEqual(extractPlaceholders(es[key]!));
    }
  });

  it("the mobileTracker namespace is present with EN+ES parity (9.3.3)", () => {
    expect(catalogs.en.mobileTracker).toBeDefined();
    expect(catalogs.es.mobileTracker).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);

    const flat = flattenMessages(catalogs.en);
    const mobileTrackerKeys = Object.keys(flat).filter((key) => key.startsWith("mobileTracker."));
    expect(mobileTrackerKeys).toHaveLength(23);
    expect(flat["mobileTracker.retry"]).toBe("Retry");
    expect(flattenMessages(catalogs.es)["mobileTracker.retry"]).toBe("Reintentar");
  });

  it("flattenMessages + mergeWithBase compose over the full catalogs", () => {
    const merged = mergeWithBase(catalogs.en, catalogs.es);
    const flat = flattenMessages(merged);
    expect(flat["nav.login"]).toBe("Iniciar sesión");
    expect(flat["hero.subtitle"]).toContain("kInorA");
  });

  it("type-level: MessageKey derives from the real 329-key catalog shape (2.2.2)", () => {
    expect(realKey).toBe("nav.login");
    expect(unknownRealKeyRejected).toBe(true);
  });
});
