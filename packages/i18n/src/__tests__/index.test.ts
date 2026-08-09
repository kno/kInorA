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
        !key.startsWith("home.") &&
        // 15a-v2-trainer-account-access Slice 5: the `clients.*` trainer
        // client-list/create-plan-for-client namespace has its own scoped
        // count test below, per the frozen-total convention.
        !key.startsWith("clients.") &&
        // 15b-v2-trainer-dashboard-branding Slice S5: the `trainerPlan.*`
        // client-facing branded-plan-view namespace has its own scoped count
        // test below, per the frozen-total convention.
        !key.startsWith("trainerPlan.") &&
        // GH #294: the `appNav.*` web app-shell nav-label namespace has its
        // own scoped count test below, per the frozen-total convention.
        !key.startsWith("appNav.") &&
        // GH #306: the `admin.*` /admin landing-page namespace has its own
        // scoped count test below, per the frozen-total convention.
        !key.startsWith("admin.") &&
        // GH #307: the `tenantProvisioning.*` /admin/tenants namespace has its
        // own scoped count test below, per the frozen-total convention.
        !key.startsWith("tenantProvisioning.") &&
        // GH #310: the `logs.*` /admin/logs observability namespace has its own
        // scoped count test below, per the frozen-total convention.
        !key.startsWith("logs.") &&
        // GH #309: the `platformStats.*` /admin/stats platform-statistics
        // namespace has its own scoped count test below, per the frozen-total
        // convention. (Distinct from the existing progress-dashboard `stats.*`.)
        !key.startsWith("platformStats.") &&
        // 16a-v3-gym-white-label: the `brandingStudio.*` /branding white-label
        // studio namespace has its own scoped count test below, per the
        // frozen-total convention.
        !key.startsWith("brandingStudio.") &&
        // 17d PR A: the `plans.*` /plans list namespace has its own scoped
        // count test below, per the frozen-total convention.
        !key.startsWith("plans."),
    );
    // +1 `tracker.restartLabel` authored for #251 (restart-timer control on
    // the live tracker topbar; pause/restart now persist across navigation).
    // +3 `tracker.load.{stepLabel,stepGroupLabel,stepOptionA11y}` authored for
    // #253 (granular load-step selector: 0.5/1/2.5/5 kg increments on the web
    // tracker; stepOptionA11y interpolates {step}).
    // +1 `plan.limitation.advisory` authored for #250 (single localized advisory
    // line shown once below the cleaned limitation bullets on the web plan
    // screens).
    // + 1 `mobileTracker.rpe.a11y` authored for 14b-v1.1 Slice B (mobile RPE
    // capture input accessibility label — the `tracker.rpe` label itself is a
    // shared key already counted).
    // + 1 `plan.branding.byTrainer` authored for 15b-v2 Slice S4 (web trainer
    // branding byline shown below the branded plan title).
    // + 1 `auth.login.gymLogoAlt` authored for 16a-v3-gym-white-label Slice
    // S4 (accessible alt text for the host-resolved gym logo on the login
    // page).
    // +43 `exercises.{library,detail,attribution}.*` authored for the exercise
    // library: the searchable/filterable `/exercises` grid, the
    // `/exercises/[id]` detail view (media toggle, stats, execution and
    // muscle tabs) and the Gym visual / exercises-dataset attribution block
    // that must accompany the media wherever it is displayed.
    // +1 `exercises.detail.media.unavailable` — the exercise animation is a
    // third-party cross-origin asset, so the media card degrades to the
    // self-hosted still on a load failure and says so rather than showing a
    // broken image.
    // +1 `exercises.detail.summary` — the dataset has no summary field, so the
    // detail page composes one from `equipment`/`target`/`bodyPart`.
    // +85 `exercises.taxonomy.*` — the dataset's controlled vocabulary (10 body
    // parts, 28 equipment, 19 targets, 40 secondary muscles, deduplicated into
    // one flat map keyed by the raw catalog value). See
    // `exercise-taxonomy.test.ts`, which fails when a catalog regeneration
    // introduces a term this map does not cover.
    // +3 `exercises.library.outOfRange.*` — an `?offset=` past the end of a
    // NON-empty result set is not "nothing matched"; the card says so and
    // links back to the first page (the pager is skipped on that branch).
    // +4 `exercises.history.{empty,error}.*` — "View my history" navigates
    // whether or not the exercise was ever logged, so the target page must
    // answer in both cases instead of rendering nothing at all.
    // +2 `exercises.technique.*` (#352 slice A) — the technique link rendered
    // beside a plan/tracker exercise. Two keys, not one: the visible label is
    // the same short word on every row, so the link also needs an accessible
    // name that says WHICH exercise it opens.
    // +7 `plan.start.{autoClosed,resume,discard,discardConfirm,
    // discardConfirmYes,discardCancel,discardFailed}` (17b scope A) — the
    // actionable under-24h conflict banner's Resume/Discard actions and the
    // auto-close notice.
    // +7 `mobileTracker.{autoClosed,conflict.resume,conflict.discard,
    // conflict.discardConfirm,conflict.discardConfirmYes,
    // conflict.discardCancel,conflict.discardFailed}` (17b scope A) — the
    // mobile equivalent (see the mobileTracker namespace test below, whose
    // own count also moves by +7).
    // +1 `history.abandoned` (17b PR 3) — the read-only history label shown
    // on an abandoned session, web and mobile.
    // +9 `profile.form.selfDescribedSex.{label,placeholder,female,male,
    // nonBinary,other,preferNotToSay}` + `profile.form.{heightCm,
    // heightCmPlaceholder}` (17c PR1) — the body-metric scalars on the
    // profile form.
    // +11 `profile.weightEntry.{heading,weightLabel,weightPlaceholder,
    // dateLabel,submit,saving,invalidWeight,invalidDate,error,listHeading,
    // listEmpty}` (17c PR2) — the bodyweight-series entry form and list.
    // +2 `profile.weight.{volumeShiftNotice,dismiss}` (17c PR4) — the
    // first-entry volume-shift notice on the web weight-entry form.
    // +1 `profile.weightEntry.loadError` (kno/kInorA#378) — distinguishes a
    // failed weight-history fetch from an empty list on mobile ProfileScreen.
    // +6 `dashboard.{errorTitle,errorBody,retry}`, `history.error`,
    // `stats.error`, `aiConfig.errors.loadFailed` (kno/kInorA#378) — the
    // remaining five collapsed-error sites (web dashboard/history/stats,
    // mobile history, and the admin AI-config panel) now render a visible,
    // distinguishable error instead of silently falling back to an empty or
    // default state.
    // `brandingStudio.errors.loadFailed` (kno/kInorA#378, a sixth
    // collapsed-error site) is NOT counted here — `brandingStudio.*` has its
    // own scoped count test below, per the frozen-total convention.
    // +2 `plan.nav.loadError.{title,desc}` (17d PR A) — the `/plan` page's
    // swallowed-error fix: a distinguishable error state, separate from the
    // pre-existing `plan.nav.empty.*` genuinely-zero-plans copy.
    // `plans.*` itself is NOT counted here — it has its own scoped count
    // test below, per the frozen-total convention.
    // +1 `plan.archived.badge` (17d PR B) — the archived-plan week-view
    // indicator shown when a plan reached via `/plan?planId=X` is archived.
    expect(nonBillingKeys).toHaveLength(804);
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
    // 14b-v1.1 Slice B adds 5 `adaptation.rpe.*` keys (title, reduceLoad,
    // increaseLoad, acceptReduce, acceptIncrease) for the `adjust_load`
    // suggestedChange banner copy branch — reusing the generic dismiss/
    // submitting/regenerating/quotaExhausted/upToDate/error copy.
    expect(adaptationKeys).toHaveLength(14);
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
    // +1 `planStatus.brandedBy` authored for 15b-v2 Slice S4 (mobile trainer
    // branding byline shown below the branded plan title).
    expect(planStatusKeys).toHaveLength(15);
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
    // 14b-v1.1 Slice B: +1 `mobileTracker.rpe.a11y` (RPE input accessibility
    // label on the mobile tracker's `ExerciseCard`).
    // 17b scope A: +7 `mobileTracker.autoClosed` +
    // `mobileTracker.conflict.{resume,discard,discardConfirm,
    // discardConfirmYes,discardCancel,discardFailed}` — Resume/Discard on
    // the full-screen conflict state and the auto-close notice text.
    expect(mobileTrackerKeys).toHaveLength(31);
    expect(flat["mobileTracker.retry"]).toBe("Retry");
    expect(flattenMessages(catalogs.es)["mobileTracker.retry"]).toBe("Reintentar");
  });

  it("the clients namespace is present with EN+ES parity (15a-v2-trainer-account-access Slice 5)", () => {
    expect(catalogs.en.clients).toBeDefined();
    expect(catalogs.es.clients).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);

    const flat = flattenMessages(catalogs.en);
    const clientsKeys = Object.keys(flat).filter((key) => key.startsWith("clients."));
    // Trainer client-list (19) + status.* (3) + createPlan.* (10) = 32.
    expect(clientsKeys).toHaveLength(32);
    expect(flat["clients.pageTitle"]).toBe("My Clients");
    expect(flattenMessages(catalogs.es)["clients.pageTitle"]).toBe("Mis clientes");
  });

  it("the trainerPlan namespace is present with EN+ES parity (15b-v2-trainer-dashboard-branding Slice S5)", () => {
    expect(catalogs.en.trainerPlan).toBeDefined();
    expect(catalogs.es.trainerPlan).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);

    const flat = flattenMessages(catalogs.en);
    const trainerPlanKeys = Object.keys(flat).filter((key) => key.startsWith("trainerPlan."));
    // navLabel (1) + denied.{title,desc} (2) + pending.{title,desc} (2) = 5.
    expect(trainerPlanKeys).toHaveLength(5);
    expect(flat["trainerPlan.navLabel"]).toBe("My trainer's plan");
    expect(flattenMessages(catalogs.es)["trainerPlan.navLabel"]).toBe("Plan de mi entrenador");
  });

  it("the appNav namespace is present with EN+ES parity (GH #294)", () => {
    expect(catalogs.en.appNav).toBeDefined();
    expect(catalogs.es.appNav).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);

    const flat = flattenMessages(catalogs.en);
    const appNavKeys = Object.keys(flat).filter((key) => key.startsWith("appNav."));
    // dashboard, plan, statistics, history, createPlan, exercises, profile,
    // more, logout = 9 web app-shell nav-label keys (MobileNav + SidebarNav).
    // + 1 `appNav.admin` authored for GH #306 (admin backoffice access point:
    // conditional Admin nav entry in SidebarNav + MobileNav's overflow menu).
    // + 1 `appNav.branding` authored for the gym Branding Studio nav entry
    // (conditional entry visible only to gym-tier tenants, mirroring admin).
    // + 1 `appNav.plans` authored for 17d PR A (the /plans nav entry, shared
    // SidebarNav.NAV_ITEMS + MobileNav.SECONDARY_TABS).
    expect(appNavKeys).toHaveLength(12);
    expect(flat["appNav.dashboard"]).toBe("Dashboard");
    expect(flattenMessages(catalogs.es)["appNav.dashboard"]).toBe("Panel");
    expect(flat["appNav.admin"]).toBeTruthy();
    expect(flattenMessages(catalogs.es)["appNav.admin"]).toBeTruthy();
    expect(flat["appNav.branding"]).toBeTruthy();
    expect(flattenMessages(catalogs.es)["appNav.branding"]).toBeTruthy();
    expect(flat["appNav.plans"]).toBe("Plans");
    expect(flattenMessages(catalogs.es)["appNav.plans"]).toBe("Planes");
  });

  it("the plans namespace is present with EN+ES parity (17d PR A — /plans list)", () => {
    expect(catalogs.en.plans).toBeDefined();
    expect(catalogs.es.plans).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const flat = flattenMessages(catalogs.en);
    const plansKeys = Object.keys(flat).filter((key) => key.startsWith("plans."));
    // title, description, error = 3 scalar + empty.{title,desc,cta} = 3 +
    // list.{currentlyFollowing,daysPerWeek,completedSessions,lastTrained,
    // neverTrained,open} = 6 + list.openDisabled.{generating,failed} = 2
    // (14, 17d PR A) + archive.{action,confirmTitle,confirmBody,confirm,
    // cancel,unarchiveAction,showToggle,hideToggle,sectionHeading} = 9
    // (17d PR B — the show-archived toggle + per-row archive/unarchive).
    expect(plansKeys).toHaveLength(23);
    expect(flat["plans.title"]).toBe("Plans");
    expect(flattenMessages(catalogs.es)["plans.title"]).toBe("Planes");
    expect(flat["plans.list.neverTrained"]).toBe("Never trained");
    expect(flattenMessages(catalogs.es)["plans.list.neverTrained"]).toBe("Nunca entrenado");
    expect(flat["plans.archive.confirmBody"]).toContain("nothing is deleted");
    expect(flattenMessages(catalogs.es)["plans.archive.confirmBody"]).toContain(
      "no se elimina nada",
    );
  });

  it("the admin namespace is present with EN+ES parity (GH #306 — admin backoffice access point)", () => {
    expect(catalogs.en.admin).toBeDefined();
    expect(catalogs.es.admin).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const flat = flattenMessages(catalogs.en);
    const adminKeys = Object.keys(flat).filter((key) => key.startsWith("admin."));
    // pageTitle, pageDescription, comingSoon (3) + 4 sections x {title,
    // description} (8) = 11 keys for the /admin landing page.
    expect(adminKeys).toHaveLength(11);
    expect(flat["admin.pageTitle"]).toBeTruthy();
    expect(flattenMessages(catalogs.es)["admin.pageTitle"]).toBeTruthy();
    expect(flat["admin.sections.aiConfig.title"]).toBeTruthy();
    expect(flat["admin.sections.tenantProvisioning.title"]).toBeTruthy();
    expect(flat["admin.sections.platformStatistics.title"]).toBeTruthy();
    expect(flat["admin.sections.logs.title"]).toBeTruthy();
  });

  it("the tenantProvisioning namespace is present with EN+ES parity (GH #307 — tenant tier-provisioning admin UI)", () => {
    expect(catalogs.en.tenantProvisioning).toBeDefined();
    expect(catalogs.es.tenantProvisioning).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const flat = flattenMessages(catalogs.en);
    const keys = Object.keys(flat).filter((key) => key.startsWith("tenantProvisioning."));
    // title, description (2) + search x6 + state x5 + grant x11 + revoke x2 +
    // errors x5 = 31 keys for the /admin/tenants provisioning panel.
    expect(keys).toHaveLength(31);
    expect(flat["tenantProvisioning.title"]).toBeTruthy();
    expect(flattenMessages(catalogs.es)["tenantProvisioning.title"]).toBeTruthy();
    expect(flat["tenantProvisioning.grant.submit"]).toBeTruthy();
    expect(flat["tenantProvisioning.errors.conflict"]).toBeTruthy();
  });

  it("the logs namespace is present with EN+ES parity (GH #310 — admin logs/observability view)", () => {
    expect(catalogs.en.logs).toBeDefined();
    expect(catalogs.es.logs).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const flat = flattenMessages(catalogs.en);
    const keys = Object.keys(flat).filter((key) => key.startsWith("logs."));
    // title, description (2) + filters x10 + level x3 + columns x7 +
    // loadMore, loadingMore (2) + empty (1) + errors x3 = 28 keys for the
    // /admin/logs observability panel.
    expect(keys).toHaveLength(28);
    expect(flat["logs.title"]).toBeTruthy();
    expect(flattenMessages(catalogs.es)["logs.title"]).toBeTruthy();
    expect(flat["logs.columns.metadata"]).toBeTruthy();
    expect(flat["logs.errors.forbidden"]).toBeTruthy();
  });

  it("the platformStats namespace is present with EN+ES parity (GH #309 — admin platform statistics view)", () => {
    expect(catalogs.en.platformStats).toBeDefined();
    expect(catalogs.es.platformStats).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const flat = flattenMessages(catalogs.en);
    const keys = Object.keys(flat).filter((key) => key.startsWith("platformStats."));
    // title, description, error (3) + sections x7 + metrics x3 + roles x3 +
    // tiers x4 + billing x4 + usage x5 + retention x12 + observability x2 = 43
    // keys for the /admin/stats platform-statistics panel (retention funnel
    // added by GH #353).
    expect(keys).toHaveLength(43);
    expect(flat["platformStats.title"]).toBeTruthy();
    expect(flattenMessages(catalogs.es)["platformStats.title"]).toBeTruthy();
    expect(flat["platformStats.billing.effectiveTier"]).toBeTruthy();
    expect(flat["platformStats.observability.errors24h"]).toBeTruthy();
    // The funnel copy renders a count AND its denominator; the parity check
    // above already proved both locales carry the same ICU arguments.
    expect(flat["platformStats.retention.ofCount"]).toBe("{value} of {total}");
    expect(flattenMessages(catalogs.es)["platformStats.retention.ofCount"]).toBe(
      "{value} de {total}",
    );
  });

  it("the brandingStudio namespace is present with EN+ES parity (16a-v3-gym-white-label — Branding Studio)", () => {
    expect(catalogs.en.brandingStudio).toBeDefined();
    expect(catalogs.es.brandingStudio).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const flat = flattenMessages(catalogs.en);
    const keys = Object.keys(flat).filter((key) => key.startsWith("brandingStudio."));
    // eyebrow/title/description (3) + subdomain x5 + logo x11 + palette x2 +
    // groups x3 + tokens x6 + presets x5 + contrast x5 + preview x13 +
    // save x3 + errors x4 = 59 keys for the /branding white-label studio
    // (errors gained `loadFailed`, kno/kInorA#378).
    expect(keys).toHaveLength(59);
    expect(flat["brandingStudio.title"]).toBeTruthy();
    expect(flattenMessages(catalogs.es)["brandingStudio.title"]).toBeTruthy();
    expect(flat["brandingStudio.errors.conflict"]).toContain("already taken");
    expect(flat["brandingStudio.tokens.accent"]).toBeTruthy();
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
