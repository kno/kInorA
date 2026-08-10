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

  // The whole-catalog key TOTAL that used to be asserted here is gone
  // (kno/kInorA#428). It was a frozen number on a single line, so every
  // concurrent branch conflicted on it, and the natural resolution — take
  // either side — stayed GREEN while discarding the other side's keys: the
  // number matched whichever catalog survived the merge.
  //
  // Its coverage now lives in two derived guards that need no hand-computed
  // aggregate:
  // - `catalog-manifest.test.ts` — every shipped key is listed by NAME in
  //   `catalog-keys.txt`, so a merge that drops keys fails and says which.
  // - `catalog-usage.test.ts` — no key the apps never render.
  // EN/ES parity stays where it always was: `validateCatalogParity`, above.
  //
  // The scoped per-namespace counts below are unaffected. They already merge
  // cleanly, because two branches touching different namespaces edit different
  // regions. If you do have to move one, do not compute it: edit the catalog
  // first, run the suite, and read the number out of the failure message
  // (`expected [ … ] to have a length of 34 but got 35`). Subtracting your own
  // key count by hand silently absorbs another branch's concurrent removals.

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
    // − 4 (kno/kInorA#436: description, plan.comparePlans, upgrade.title and
    //   usage.row were rendered nowhere — copy left behind by the Slice 5
    //   screen, which renders its own hero/meter/CTA keys instead).
    expect(billingKeys).toHaveLength(86);
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
    // 17d PR C: +1 `mobileTracker.error.planArchived` — the tracker's own
    // words for PR B's `409 plan_archived` start refusal.
    // kno/kInorA#409: +2 `mobileTracker.error.{dayNotInPlan,
    // dayNotInPlanNoDays}` — the sibling `404 day_not_in_plan` refusal, in
    // its two shapes (some days remain, or none do).
    // kno/kInorA#436: −1 `mobileTracker.autoClosed`. The 17b conflict UI it
    // shipped with is live and renders the `conflict.*` siblings, but the
    // auto-close NOTICE was never built on mobile — the screen drops the
    // `autoClosedSession` the API returns. Web renders it as
    // `plan.start.autoClosed`; mobile authors its own key when it renders one.
    expect(mobileTrackerKeys).toHaveLength(33);
    expect(flat["mobileTracker.error.planArchived"]).toContain("archived");
    expect(flattenMessages(catalogs.es)["mobileTracker.error.planArchived"]).toContain(
      "archivado",
    );
    // Both `day_not_in_plan` messages name the requested day; only the
    // some-days-remain variant interpolates the list-formatted `{days}`.
    expect(flat["mobileTracker.error.dayNotInPlan"]).toContain("{days}");
    expect(flattenMessages(catalogs.es)["mobileTracker.error.dayNotInPlan"]).toContain("{days}");
    expect(flat["mobileTracker.error.dayNotInPlanNoDays"]).not.toContain("{days}");
    expect(flattenMessages(catalogs.es)["mobileTracker.error.dayNotInPlanNoDays"]).not.toContain(
      "{days}",
    );
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
    // Trainer client-list (19) + status.* (3) + createPlan.* (10) = 32,
    // − 1 (kno/kInorA#436: `createPlan.success` — the web and mobile forms both
    //   navigate away on success rather than rendering a confirmation).
    expect(clientsKeys).toHaveLength(31);
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
    // (17d PR B — the show-archived toggle + per-row archive/unarchive)
    // (23) + archive.bulk.{selectLabel,selectedCount,action,clear,confirmTitle,
    // confirmBody,successBody,resultTitle,resultArchived,resultFailed} = 10
    // (#412 — the bulk selection, its own pluralised confirm, and the
    // partial-failure report that names both groups). Bulk reuses
    // archive.{confirm,cancel} rather than authoring its own buttons.
    expect(plansKeys).toHaveLength(33);
    expect(flat["plans.title"]).toBe("Plans");
    expect(flattenMessages(catalogs.es)["plans.title"]).toBe("Planes");
    expect(flat["plans.list.neverTrained"]).toBe("Never trained");
    expect(flattenMessages(catalogs.es)["plans.list.neverTrained"]).toBe("Nunca entrenado");
    expect(flat["plans.archive.confirmBody"]).toContain("nothing is deleted");
    expect(flattenMessages(catalogs.es)["plans.archive.confirmBody"]).toContain(
      "no se elimina nada",
    );
    // #412: the bulk confirm is a DIFFERENT message with the SAME promise. That
    // sentence is why this feature is archive-and-not-delete — `workout_sessions`
    // cascades from a plan, so a real delete would erase every logged workout —
    // and it has to survive pluralisation in both catalogs, in both branches.
    const enBulkBody = flat["plans.archive.bulk.confirmBody"]!;
    const esBulkBody = flattenMessages(catalogs.es)["plans.archive.bulk.confirmBody"]!;
    expect(enBulkBody.split("nothing is deleted")).toHaveLength(3);
    expect(esBulkBody.split("no se elimina nada")).toHaveLength(3);
    // And it is genuinely countable, not a singular message reused.
    expect(enBulkBody).toContain("plural");
    expect(esBulkBody).toContain("plural");
  });

  it("the planEdit namespace is present with EN+ES parity (17d PR D — program editor)", () => {
    expect(catalogs.en.planEdit).toBeDefined();
    expect(catalogs.es.planEdit).toBeDefined();

    const result = validateCatalogParity(catalogs.en, catalogs.es);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    const flat = flattenMessages(catalogs.en);
    const planEditKeys = Object.keys(flat).filter((key) => key.startsWith("planEdit."));
    // title, description, openAction, error = 4 scalar + the form labels
    // dayNumberLabel, dayTitleLabel, exerciseNameLabel, exerciseSetsLabel,
    // exerciseRepsLabel, exerciseRestLabel = 6 + the controls addDay,
    // addExercise, removeDay, removeExercise, save, saving, saved,
    // validationTitle = 8 + issues.{empty_program,duplicate_day,invalid_day,
    // empty_session} = 4 (one per EditedProgramIssue the domain can report) +
    // conflict.{title,desc,reload} = 3 (the lost-race message, distinct from a
    // validation failure) + notReady.{title,desc} = 2 + loadError.{title,desc}
    // = 2 (a failed read must never render as an empty form)
    // (29, 17d PR D) + nameLabel = 1 + issues.{plan_name_empty,
    // plan_name_too_long} = 2 (one per PlanNameIssue, #415's rename field).
    expect(planEditKeys).toHaveLength(32);
    expect(flat["planEdit.issues.empty_program"]).toContain("at least one training day");
    expect(flattenMessages(catalogs.es)["planEdit.issues.empty_program"]).toContain(
      "al menos un día",
    );
    // #415: renaming to blank is refused, not silently resolved to the
    // date-based default — the copy has to say which, in both catalogs.
    expect(flat["planEdit.issues.plan_name_empty"]).toContain("creation date");
    expect(flattenMessages(catalogs.es)["planEdit.issues.plan_name_empty"]).toContain(
      "fecha de creación",
    );
    // The conflict copy must promise nothing was saved — that is the whole
    // reassurance the losing writer needs before reloading.
    expect(flat["planEdit.conflict.desc"]).toContain("nothing of yours was saved");
    expect(flattenMessages(catalogs.es)["planEdit.conflict.desc"]).toContain(
      "no se guardó nada",
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
    // description} (8) = 11, + eyebrow, sectionEyebrow, open and notice x2 (5)
    // for the Open Design chrome (kno/kInorA#414) = 16 keys for the /admin
    // landing page and the shared backoffice page shell,
    // − 1 (kno/kInorA#436: `comingSoon` — #414's `notice.{title,body}` pair
    //   replaced that single line and the old key was left behind).
    expect(adminKeys).toHaveLength(15);
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
    // errors x5 = 31, + 13 step/heading/empty-state/hint keys for the Open
    // Design three-step layout (kno/kInorA#414) = 44 keys for the
    // /admin/tenants provisioning panel.
    expect(keys).toHaveLength(44);
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
    // loadMore, loadingMore (2) + empty (1) + errors x3 = 28, + 10 keys for the
    // panel headings and the three now-distinct result states (kno/kInorA#414:
    // idle x3, empty x3, errorEyebrow, filtersTitle, resultsTitle, cursorNote)
    // = 38 keys for the /admin/logs observability panel,
    // − 1 (kno/kInorA#436: the scalar `empty` — #414 split the empty state into
    //   `empty{Eyebrow,Title,Description}` and the scalar stopped being read).
    expect(keys).toHaveLength(37);
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
    // + errorEyebrow, funnelTitle and cohortsTitle (3) for the Open Design
    // layout (kno/kInorA#414) = 46.
    expect(keys).toHaveLength(46);
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
    // (errors gained `loadFailed`, kno/kInorA#378),
    // − 2 (kno/kInorA#436: logo.{browse,remove} — the logo control is a
    //   drag-and-drop zone with no Browse or Remove button to label).
    expect(keys).toHaveLength(57);
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
