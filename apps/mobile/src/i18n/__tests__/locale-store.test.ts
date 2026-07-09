import { describe, expect, it, vi } from "vitest";
import { createLocaleStore } from "../locale-store.js";

describe("createLocaleStore", () => {
  it("starts at the given initial locale (defaults to en)", () => {
    expect(createLocaleStore().getLocale()).toBe("en");
    expect(createLocaleStore("es").getLocale()).toBe("es");
  });

  it("setLocale updates the snapshot returned by getLocale (runtime switch, no restart)", () => {
    const store = createLocaleStore("es");
    store.setLocale("en");
    expect(store.getLocale()).toBe("en");
  });

  it("notifies subscribers when the locale changes", () => {
    const store = createLocaleStore("en");
    const listener = vi.fn();
    store.subscribe(listener);

    store.setLocale("es");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify subscribers when setting the same locale", () => {
    const store = createLocaleStore("en");
    const listener = vi.fn();
    store.subscribe(listener);

    store.setLocale("en");

    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const store = createLocaleStore("en");
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();

    store.setLocale("es");

    expect(listener).not.toHaveBeenCalled();
  });
});
