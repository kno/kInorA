/**
 * Cross-runtime parity (9.4.3/9.4.4) — proves mobile's react-intl and web's
 * next-intl render IDENTICAL text for the same shared `@kinora/i18n` key,
 * arguments, and locale. Both runtimes are built on the same ICU engine
 * (`intl-messageformat`); this guards against a catalog change or formatter
 * option accidentally diverging between the two boundaries.
 *
 * next-intl's own React entrypoints require Next's "react-server" resolve
 * condition (not available under Vitest — same constraint documented in
 * apps/web/src/i18n/__tests__/request.test.ts). `createTranslator` from
 * `use-intl/core` is the exact engine next-intl's `getTranslations`/
 * `useTranslations` call under the hood — `apps/web/src/test-utils/
 * server-translator.ts` uses the same import for the identical reason —
 * so exercising it here is a faithful stand-in for "what web renders",
 * not a separate reimplementation.
 */
import { createIntl } from "react-intl";
import { createTranslator } from "use-intl/core";
import { catalogs, flattenMessages } from "@kinora/i18n";
import { describe, expect, it } from "vitest";

// react-intl needs flat `id -> string` messages (the same shape
// `resolveMessages`/`LocaleProvider` feed it at the real app boundary);
// next-intl/use-intl consumes the nested catalog shape directly.
function mobileRender(locale: "en" | "es", id: string, values?: Record<string, number>) {
  const intl = createIntl({ locale, messages: flattenMessages(catalogs[locale]) });
  return intl.formatMessage({ id }, values);
}

function webRender(locale: "en" | "es", id: string, values?: Record<string, number>) {
  const t = createTranslator({ locale, messages: catalogs[locale] });
  return t(id as never, values as never);
}

describe("cross-runtime i18n parity: react-intl (mobile) vs next-intl's engine (web)", () => {
  it("renders identical text for a plain-interpolation key in en", () => {
    const mobile = mobileRender("en", "tracker.tracking.day", { n: 3 });
    const web = webRender("en", "tracker.tracking.day", { n: 3 });

    expect(mobile).toBe(web);
    expect(mobile).toBe("Day 3");
  });

  it("renders identical text for a plain-interpolation key in es", () => {
    const mobile = mobileRender("es", "tracker.tracking.day", { n: 3 });
    const web = webRender("es", "tracker.tracking.day", { n: 3 });

    expect(mobile).toBe(web);
    expect(mobile).toBe("Día 3");
  });

  it("selects the SAME plural branch for count=1 and count=3 (tracker.next.sets)", () => {
    for (const n of [1, 3]) {
      const mobile = mobileRender("en", "tracker.next.sets", { n });
      const web = webRender("en", "tracker.next.sets", { n });
      expect(mobile).toBe(web);
    }

    expect(mobileRender("en", "tracker.next.sets", { n: 1 })).toBe("1 set");
    expect(mobileRender("en", "tracker.next.sets", { n: 3 })).toBe("3 sets");
  });

  it("renders identical text for a newly authored mobile-only key (mobileTracker.retry)", () => {
    const mobile = mobileRender("es", "mobileTracker.retry");
    const web = webRender("es", "mobileTracker.retry");

    expect(mobile).toBe(web);
    expect(mobile).toBe("Reintentar");
  });
});

describe("10.3: plural parity with web (both ICU branches, second shared plural key)", () => {
  it("selects the SAME branch as web for count=1 (one) and count=3 (other) — tracker.timeline.meta.done", () => {
    for (const n of [1, 3]) {
      const mobile = mobileRender("en", "tracker.timeline.meta.done", { n });
      const web = webRender("en", "tracker.timeline.meta.done", { n });
      expect(mobile).toBe(web);
    }

    expect(mobileRender("en", "tracker.timeline.meta.done", { n: 1 })).toBe("1 set · completed");
    expect(mobileRender("en", "tracker.timeline.meta.done", { n: 3 })).toBe("3 sets · completed");
  });

  it("holds the same parity in es", () => {
    for (const n of [1, 3]) {
      const mobile = mobileRender("es", "tracker.timeline.meta.done", { n });
      const web = webRender("es", "tracker.timeline.meta.done", { n });
      expect(mobile).toBe(web);
    }

    expect(mobileRender("es", "tracker.timeline.meta.done", { n: 1 })).toBe(
      "1 serie · completado",
    );
    expect(mobileRender("es", "tracker.timeline.meta.done", { n: 3 })).toBe(
      "3 series · completado",
    );
  });
});
