import { describe, expect, it } from "vitest";
import { catalogs, flattenMessages, mergeWithBase, validateCatalogParity } from "../index.js";
import type { MessageKey } from "../index.js";

const PROFILE_AND_PREFERENCES_KEYS = [
  "profile.title",
  "profile.description",
  "profile.loading.title",
  "profile.loading.description",
  "profile.loading.progressAria",
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
    // + 18 `profile.*` keys authored in 10a for the /profile experience
    // (3 `profile.loading.*` loading-state keys + 12 `profile.form.*`
    // heading/labels/placeholders/feedback + 3 `profile.experience.*`
    // level labels; goal select reuses wizard.goal.*)
    // + 5 `wizard.preferences.*` keys authored in 10a Slice 5 for the
    // defaults step title/labels and preferences-save error feedback.
    // + 39 `memory.*` keys authored in 10b for the memory-management surface.
    //
    // NOTE (review correction, 11a Phase 4 / Slice 4): this whole-catalog
    // magic total is intentionally FROZEN at 609 (its value before the
    // `billing.*` namespace was added) by excluding `billing.*` keys from
    // this count, rather than bumping the total again. A global total that
    // every future namespace addition must edit is exactly the brittleness
    // flagged in review — it breaks on ANY unrelated key addition, not just
    // regressions. New namespaces from here on should add their OWN scoped
    // count test (see "the billing namespace is present with EN+ES parity"
    // below, mirroring the mobileTracker pattern) and exclude themselves
    // here, instead of bumping this number.
    const flat = flattenMessages(catalogs.en);
    const nonBillingKeys = Object.keys(flat).filter(
      (key) =>
        !key.startsWith("billing.") &&
        !key.startsWith("chat.") &&
        !key.startsWith("voice.") &&
        // 14a-v1.1 Slice B1: the `adaptation.*` namespace has its own scoped
        // count test below, per the frozen-total convention noted above.
        !key.startsWith("adaptation.") &&
        // 14a-v1.1 Slice C2: the `planStatus.*` mobile plan-status-screen
        // namespace has its own scoped count test below.
        !key.startsWith("planStatus.") &&
        // 14a-v1.1 Slice C3: the `home.*` mobile home-screen namespace has its
        // own scoped count test below.
        !key.startsWith("home."),
    );
    expect(nonBillingKeys).toHaveLength(609);
  });

  it("the chat namespace is present with EN+ES parity (12 Slice 3)", () => {
    expect(catalogs.en.chat).toBeDefined();
    expect(catalogs.es.chat).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("the voice namespace is present with EN+ES parity (13 Slice B1 + B2)", () => {
    expect(catalogs.en.voice).toBeDefined();
    expect(catalogs.es.voice).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);

    const en = flattenMessages(catalogs.en);
    const es = flattenMessages(catalogs.es);
    const voiceKeys = Object.keys(en).filter((key) => key.startsWith("voice."));
    // B1: 8 scalar (micLabel, startAria, stopAria, denied, unsupported, offline,
    // unclear, error) + 3 `voice.state.*` (idle/listening/processing).
    // B2: +2 scalar (stopSpeaking, stopSpeakingAria) + 1 `voice.state.speaking`.
    // D1 (mobile voice screen): +8 scalar (screenTitle, hold, backAria,
    // keyboardAria, endSession, endSessionAria, roleYou, roleCoach)
    // + 1 `voice.state.responding`.
    // #231 (mobile Free-tier Pro gate): +1 scalar (premium).
    // voice-provider-adapters: +1 scalar (rate_limited — 429 from the
    // transcribe proxy).
    expect(voiceKeys).toHaveLength(26);
    expect(en["voice.state.listening"]).toBe("Listening…");
    expect(es["voice.state.listening"]).toBe("Escuchando…");
    // B2 playback copy — the speaking state and the stop-speaking control.
    expect(en["voice.state.speaking"]).toBe("Speaking…");
    expect(es["voice.state.speaking"]).toBe("Hablando…");
    expect(en["voice.stopSpeaking"]).toBeTruthy();
    expect(es["voice.stopSpeaking"]).toBeTruthy();
    expect(en["voice.stopSpeakingAria"]).toBeTruthy();
    expect(es["voice.stopSpeakingAria"]).toBeTruthy();
    // D1 mobile voice screen copy — the responding state + screen chrome.
    expect(en["voice.state.responding"]).toBe("kInorA is responding…");
    expect(es["voice.state.responding"]).toBe("kInorA responde…");
    expect(en["voice.screenTitle"]).toBeTruthy();
    expect(es["voice.screenTitle"]).toBeTruthy();
    expect(en["voice.hold"]).toBeTruthy();
    expect(es["voice.hold"]).toBeTruthy();
  });

  it("the billing namespace is present with EN+ES parity (11a Phase 4 / Slice 4)", () => {
    expect(catalogs.en.billing).toBeDefined();
    expect(catalogs.es.billing).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);

    const en = flattenMessages(catalogs.en);
    const es = flattenMessages(catalogs.es);
    const billingKeys = Object.keys(en).filter((key) => key.startsWith("billing."));
    // 34 (11a Phase 4) + 49 (11b Slice 5 web billing screen: plan hero meta,
    // usage meters + "up to N/mo" metered copy, invoice history, Pro card with
    // cycle toggle + save badge, payment-method + support cards, CTA actions)
    // + 1 (11b Slice 5 4R FIX 1: distinct Price/Current-period plan-hero copy)
    // + 2 (#198 subscription-ended access banner: endedTitle/endedDescription)
    // + 11 (#199 billing help FAQ page: title/intro/backToBilling + 4 Q/A pairs)
    // − 5 (payment-method surface removed: plan.metaPayment, payment.{title,
    //   description,manageCta}, actions.portalError).
    // − 2 (current-period tile removed: plan.metaPeriod, plan.periodTrialEndsOn).
    expect(billingKeys).toHaveLength(90);
    expect(en["billing.tier.free"]).toBe("Free");
    expect(es["billing.tier.free"]).toBe("Gratis");
  });

  it("the adaptation namespace is present with EN+ES parity (14a-v1.1 Slice B2)", () => {
    expect(catalogs.en.adaptation).toBeDefined();
    expect(catalogs.es.adaptation).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);

    const en = flattenMessages(catalogs.en);
    const es = flattenMessages(catalogs.es);
    const adaptationKeys = Object.keys(en).filter((key) => key.startsWith("adaptation."));
    // B1 shipped 6 minimal banner keys (title, suggestion, accept, dismiss,
    // regenerating, error). B2 rounds the namespace out to 9 by adding the
    // distinct UX-state copy: `submitting` (pending affordance while the accept
    // POST is in flight), `quotaExhausted` (403 — plan change used this period /
    // upgrade), and `upToDate` (409 no_adaptation — plan already a good fit).
    expect(adaptationKeys).toHaveLength(9);
    // The from→to interpolation is the option-framed suggestion.
    expect(en["adaptation.suggestion"]).toContain("{toDays}");
    expect(en["adaptation.suggestion"]).toContain("{fromDays}");
    expect(es["adaptation.suggestion"]).toContain("{toDays}");
    expect(es["adaptation.suggestion"]).toContain("{fromDays}");
    // B2 distinct result-code copy present in BOTH locales.
    for (const key of ["adaptation.submitting", "adaptation.quotaExhausted", "adaptation.upToDate"]) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
    }
  });

  it("the planStatus namespace is present with EN+ES parity (14a-v1.1 Slice C2)", () => {
    expect(catalogs.en.planStatus).toBeDefined();
    expect(catalogs.es.planStatus).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);

    const en = flattenMessages(catalogs.en);
    const es = flattenMessages(catalogs.es);
    const planStatusKeys = Object.keys(en).filter((key) =>
      key.startsWith("planStatus."),
    );
    // C2 mobile plan-status screen copy: loading, generatingTitle/Body,
    // readyTitle, readySessions (with {count}), failedTitle/Body, regenerate,
    // regenerating, retry, error. (The 403 quota notice reuses
    // `adaptation.quotaExhausted`, so no planStatus key duplicates it.)
    // Post-review poll-loop fixes add 3: stalledTitle/Body + refresh (the
    // "taking longer than expected" terminal state after the poll-attempts cap).
    expect(planStatusKeys).toHaveLength(14);
    expect(en["planStatus.readySessions"]).toContain("{count}");
    expect(es["planStatus.readySessions"]).toContain("{count}");
    expect(en["planStatus.stalledTitle"]).toBeTruthy();
    expect(es["planStatus.stalledTitle"]).toBeTruthy();
    expect(en["planStatus.refresh"]).toBeTruthy();
    expect(es["planStatus.refresh"]).toBeTruthy();
  });

  it("the home namespace is present with EN+ES parity (14a-v1.1 Slice C3)", () => {
    expect(catalogs.en.home).toBeDefined();
    expect(catalogs.es.home).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);

    const en = flattenMessages(catalogs.en);
    const es = flattenMessages(catalogs.es);
    const homeKeys = Object.keys(en).filter((key) => key.startsWith("home."));
    // C3 mobile home-screen copy: title, subtitle, loading, error, retry,
    // viewPlan (the plan-status nav entry), noPlanTitle/noPlanBody (empty state).
    expect(homeKeys).toHaveLength(8);
    expect(en["home.viewPlan"]).toBeTruthy();
    expect(es["home.viewPlan"]).toBeTruthy();
    expect(en["home.noPlanTitle"]).toBeTruthy();
    expect(es["home.noPlanTitle"]).toBeTruthy();
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
