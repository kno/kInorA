/**
 * Slice 10, Phase 10.2 — `{select}` + number/date parity (SC#3), mirroring
 * web's Gap 1 coverage from slice 5 (`PlanSelector`'s `plan.selector.option`
 * ICU `select` + `useFormatter().dateTime`).
 *
 * Reuses the EXISTING `plan.selector.option` key (authored in slice 5, no
 * mobile-only key needed — mobile has no plan-selector screen in this
 * slice's scope, so this proves the runtime capability directly, the same
 * way `cross-runtime-parity.test.ts` proves engine parity without wiring a
 * production screen for every key). Dates are never baked into this
 * catalog's ICU strings (see `plan.selector.option`'s design note) — mirrors
 * web's own choice to format dates via a formatter API on a raw `Date`,
 * not an ICU `{date}` argument — so the date assertion below exercises
 * `<FormattedDate>` directly, matching that same convention on mobile.
 *
 * `<FormattedMessage>`/`<FormattedNumber>`/`<FormattedDate>` render bare
 * text as their own root (no wrapping host element under a bare
 * `IntlProvider`), so assertions read the renderer's `toJSON()` output
 * directly rather than `findAllByProps` (which only matches element props,
 * not raw text nodes).
 */
import React from "react";
import { act, create } from "react-test-renderer";
import { FormattedDate, FormattedMessage, FormattedNumber, IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";
import { resolveMessages } from "../locale.js";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function renderText(locale: "en" | "es", node: React.ReactNode) {
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <IntlProvider locale={locale} defaultLocale="en" messages={resolveMessages(locale)}>
        {node}
      </IntlProvider>,
    );
  });
  return renderer.toJSON();
}

describe("10.2.1: ICU {select} branch via <FormattedMessage> (plan.selector.option)", () => {
  it.each([
    ["ready", "Ready"],
    ["generating", "Generating"],
    ["failed", "Failed"],
    ["somethingElse", "Unknown"],
  ])("selects the %s branch in en", (status, enText) => {
    expect(
      renderText("en", <FormattedMessage id="plan.selector.option" values={{ status }} />),
    ).toBe(enText);
  });

  it.each([
    ["ready", "Listo"],
    ["generating", "Generando"],
    ["failed", "Fallido"],
    ["somethingElse", "Desconocido"],
  ])("selects the %s branch in es", (status, esText) => {
    expect(
      renderText("es", <FormattedMessage id="plan.selector.option" values={{ status }} />),
    ).toBe(esText);
  });
});

describe("10.2.2: <FormattedNumber>/<FormattedDate> render locale-correct output", () => {
  it("formats a number with the locale's thousands separator", () => {
    // es-ES's CLDR grouping pattern only kicks in from 5 digits (12345), not
    // 4 (1234) — pick a value where en/es diverge visibly.
    expect(renderText("en", <FormattedNumber value={12345} />)).toBe("12,345");
    expect(renderText("es", <FormattedNumber value={12345} />)).toBe("12.345");
  });

  it("formats a date with the locale's month/day order and language", () => {
    const date = new Date(Date.UTC(2026, 6, 9)); // 2026-07-09
    const dateNode = (
      <FormattedDate value={date} year="numeric" month="long" day="numeric" timeZone="UTC" />
    );
    expect(renderText("en", dateNode)).toBe("July 9, 2026");
    expect(renderText("es", dateNode)).toBe("9 de julio de 2026");
  });
});

describe("10.2.3: confirm both 10.2.1 and 10.2.2 pass together", () => {
  it("renders a select branch alongside a formatted number in one tree", () => {
    const tree = renderText(
      "es",
      <>
        <FormattedMessage id="plan.selector.option" values={{ status: "ready" }} />
        {" · "}
        <FormattedNumber value={7} />
      </>,
    );
    expect(tree).toEqual(["Listo", " · ", "7"]);
  });
});
