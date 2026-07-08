import { describe, expect, it } from "vitest";
import { flattenMessages } from "../flatten.js";

describe("flattenMessages", () => {
  it("dot-joins nested keys into a flat record", () => {
    const nested = {
      nav: {
        home: "Home",
        about: "About",
      },
      hero: {
        title: "Welcome",
      },
    };

    expect(flattenMessages(nested)).toEqual({
      "nav.home": "Home",
      "nav.about": "About",
      "hero.title": "Welcome",
    });
  });

  it("dot-joins arbitrarily deep nesting", () => {
    const nested = {
      tracker: {
        timeline: {
          meta: {
            done: "{n, plural, one {# done} other {# done}}",
          },
        },
      },
    };

    expect(flattenMessages(nested)).toEqual({
      "tracker.timeline.meta.done": "{n, plural, one {# done} other {# done}}",
    });
  });

  it("returns an empty record for an empty catalog", () => {
    expect(flattenMessages({})).toEqual({});
  });
});
