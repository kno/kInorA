import { expect, test } from "@playwright/test";
import { closeSeedPool, registerTenant, seedFreeTenant, useSession } from "./helpers/billing-seed";

/**
 * Create-plan Asistente chat flow e2e (issue #213).
 *
 * The 12-v1.1 interactive-text-chat mode toggle (Pro → Asistente, Free →
 * Formulario + upgrade teaser) and the "Extracted data" panel were previously
 * proven only in component tests with a mocked SSE stream, never as ONE live
 * session against the real Next.js app + Fastify api + migrated Postgres booted
 * by `scripts/e2e-with-stack.mjs`. This spec closes that gap for the
 * deterministic surface.
 *
 * IMPORTANT — the e2e stack has NO LLM key (CI logs: "OPENROUTER_API_KEY is not
 * set — AI plan generation will fail at call time"), so a LIVE chat turn cannot
 * complete. This spec therefore asserts only model-INDEPENDENT behavior:
 *   - the server-derived default mode (Pro → Asistente, Free → Formulario),
 *   - the Free upgrade teaser + CTA (and the absence of a working chat input),
 *   - the "Extracted data" panel hydrating from a SEEDED draft (via the same
 *     `POST /plan-specs/drafts` the wizard uses), and
 *   - that sending a chat message with no model configured surfaces the
 *     graceful error + Retry affordance rather than crashing the page.
 *
 * A live keyed model turn (real streamed tokens + a terminal `draft` event that
 * populates the panel from the assistant, plus TTS) is deferred to a keyed
 * environment — see the KEYED-ENV FOLLOW-UP note at the bottom of this file.
 *
 * Requires the api + migrated Postgres booted by `scripts/e2e-with-stack.mjs`.
 */

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";

test.describe("Create-plan Asistente flow (#213)", () => {
  test.afterAll(async () => {
    await closeSeedPool();
  });

  test("a Pro tenant lands on Asistente with the mode toggle, an extracted-data panel seeded from a draft, and a graceful error when no model is configured", async ({
    page,
  }) => {
    // A fresh registration is a Pro/trialing tenant → Asistente is the default.
    const tenant = await registerTenant(page);

    // Seed a PARTIAL draft through the same endpoint the wizard uses so the
    // "Extracted data" panel hydrates with real values (no model needed).
    const seeded = await page.request.post(`${API_BASE}/plan-specs/drafts`, {
      headers: { authorization: `Bearer ${tenant.token}` },
      data: { step: 1, spec: { goal: "strength", daysPerWeek: 4 } },
    });
    expect(seeded.ok(), "seeding a draft should succeed").toBeTruthy();

    await useSession(page, tenant.token);
    await page.goto("/create-plan");

    // The mode toggle is present, with Asistente pressed by default (Pro).
    const assistant = page.locator("#btn-asistente");
    const formulario = page.locator("#btn-formulario");
    await expect(assistant).toBeVisible();
    await expect(formulario).toBeVisible();
    await expect(assistant).toHaveAttribute("aria-pressed", "true");

    // The Asistente pane renders the "Extracted data" panel, hydrated from the
    // seeded draft (the Goal select reflects the seeded value).
    await expect(page.getByRole("heading", { name: "Extracted data" })).toBeVisible();
    await expect(page.getByLabel("Edit Goal")).toHaveValue("strength");

    // Send a chat message. With no model configured the turn cannot complete —
    // it must surface the graceful error + Retry affordance, never crash.
    const input = page.getByRole("textbox", { name: "Chat message" });
    await input.fill("Build muscle four days a week");
    await page.getByRole("button", { name: "Send message" }).click();

    // Deterministic without a model: the terminal error renders a Retry button…
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 30_000 });
    // …and the page is still interactive (the input remains usable — no crash).
    await expect(input).toBeEnabled();
  });

  test("a Free tenant defaults to Formulario and the Asistente tab shows the upgrade teaser (no working chat)", async ({
    page,
  }) => {
    // Reshape the fresh (Pro/trialing) tenant into a plain Free tenant so the
    // server resolves the Formulario default + the Asistente teaser.
    const tenant = await registerTenant(page);
    await seedFreeTenant(tenant.tenantId);
    await useSession(page, tenant.token);

    await page.goto("/create-plan");

    // Free defaults to the Formulario wizard (its step readout is present).
    const assistant = page.locator("#btn-asistente");
    const formulario = page.locator("#btn-formulario");
    await expect(formulario).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("1 / 7")).toBeVisible();

    // Switching to Asistente shows the teaser + the upgrade CTA to the 11b
    // billing Pro card — NOT a working chat.
    await assistant.click();
    await expect(
      page.getByRole("heading", { name: "Create your plan by chatting" }),
    ).toBeVisible();
    const cta = page.getByRole("link", { name: "Upgrade to Pro" });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/billing#pro-card");
    // The working chat input is absent for a Free tenant (teaser only).
    await expect(page.getByRole("textbox", { name: "Chat message" })).toHaveCount(0);
  });
});

/**
 * KEYED-ENV FOLLOW-UP (do NOT fake a pass here) — asserting a full live chat
 * turn needs an OPENROUTER/OpenAI key the e2e stack deliberately does not carry:
 *
 *   [ ] With a model configured, send a message and assert streamed assistant
 *       tokens render incrementally, the terminal `draft` event populates the
 *       "Extracted data" panel (goal/location/days/duration/equipment/limits)
 *       from the assistant, and "Generate plan" enables once the spec is valid.
 *   [ ] TTS playback after a voice-initiated turn (covered structurally by the
 *       component tests; a live keyed run confirms the audio path end-to-end).
 */
