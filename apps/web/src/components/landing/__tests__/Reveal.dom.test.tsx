// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Reveal } from "../Reveal";

/**
 * `Reveal.test.tsx` covers the rendered markup via `renderToStaticMarkup`,
 * which never runs the effect. These tests run it in jsdom to cover the
 * actual reveal mechanic: the element must end up with
 * `kin-landing-reveal--in` on every path, because that class is what makes
 * it visible. Failing to add it leaves the content permanently hidden.
 */

const IN = "kin-landing-reveal--in";

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

interface FakeObserver {
  callback: ObserverCallback;
  observed: Element[];
  unobserved: Element[];
  disconnected: boolean;
}

let observers: FakeObserver[] = [];
const originalIO = window.IntersectionObserver;

/** Installs a fake IntersectionObserver and records every instance. */
function installObserver() {
  observers = [];
  class FakeIntersectionObserver {
    constructor(callback: ObserverCallback) {
      this.record = {
        callback,
        observed: [],
        unobserved: [],
        disconnected: false,
      };
      observers.push(this.record);
    }
    private record: FakeObserver;
    observe(el: Element) {
      this.record.observed.push(el);
    }
    unobserve(el: Element) {
      this.record.unobserved.push(el);
    }
    disconnect() {
      this.record.disconnected = true;
    }
  }
  Object.defineProperty(window, "IntersectionObserver", {
    value: FakeIntersectionObserver,
    configurable: true,
    writable: true,
  });
}

/** The single observer Reveal is expected to have created. */
function onlyObserver(): FakeObserver {
  expect(observers).toHaveLength(1);
  const observer = observers[0];
  if (!observer) throw new Error("no IntersectionObserver was constructed");
  return observer;
}

/** Reports whether the user prefers reduced motion. */
function mockReducedMotion(reduced: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
}

beforeEach(() => {
  installObserver();
  mockReducedMotion(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(window, "IntersectionObserver", {
    value: originalIO,
    configurable: true,
    writable: true,
  });
});

describe("Reveal", () => {
  it("stays hidden until the element actually scrolls into view", () => {
    const { container } = render(
      <Reveal>
        <p>Deferred</p>
      </Reveal>,
    );
    const el = container.firstElementChild as HTMLElement;

    expect(el.classList.contains(IN)).toBe(false);
    expect(onlyObserver().observed).toEqual([el]);
  });

  it("reveals the element and stops observing once it intersects", () => {
    const { container } = render(
      <Reveal>
        <p>Deferred</p>
      </Reveal>,
    );
    const el = container.firstElementChild as HTMLElement;

    act(() => {
      onlyObserver().callback([
        { isIntersecting: true, target: el } as unknown as IntersectionObserverEntry,
      ]);
    });

    expect(el.classList.contains(IN)).toBe(true);
    // Reveal is one-shot: it must unobserve so scrolling away cannot re-fire.
    expect(onlyObserver().unobserved).toEqual([el]);
  });

  it("ignores entries that are not intersecting", () => {
    const { container } = render(
      <Reveal>
        <p>Deferred</p>
      </Reveal>,
    );
    const el = container.firstElementChild as HTMLElement;

    act(() => {
      onlyObserver().callback([
        { isIntersecting: false, target: el } as unknown as IntersectionObserverEntry,
      ]);
    });

    expect(el.classList.contains(IN)).toBe(false);
    expect(onlyObserver().unobserved).toEqual([]);
  });

  it("reveals immediately under prefers-reduced-motion, without observing", () => {
    mockReducedMotion(true);
    const { container } = render(
      <Reveal>
        <p>Instant</p>
      </Reveal>,
    );
    const el = container.firstElementChild as HTMLElement;

    expect(el.classList.contains(IN)).toBe(true);
    expect(observers).toHaveLength(0);
  });

  it("reveals immediately when IntersectionObserver is unavailable", () => {
    // Without this fallback the content would never become visible on
    // browsers lacking IntersectionObserver.
    // @ts-expect-error deliberately removing the global for this test
    delete window.IntersectionObserver;

    const { container } = render(
      <Reveal>
        <p>Fallback</p>
      </Reveal>,
    );
    const el = container.firstElementChild as HTMLElement;

    expect(el.classList.contains(IN)).toBe(true);
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = render(
      <Reveal>
        <p>Deferred</p>
      </Reveal>,
    );
    expect(onlyObserver().disconnected).toBe(false);

    unmount();

    expect(onlyObserver().disconnected).toBe(true);
  });

  it("applies the reveal class to the custom tag from the as prop", () => {
    const { container } = render(
      <Reveal as="section">
        <p>Tagged</p>
      </Reveal>,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("SECTION");

    act(() => {
      onlyObserver().callback([
        { isIntersecting: true, target: el } as unknown as IntersectionObserverEntry,
      ]);
    });

    expect(el.classList.contains(IN)).toBe(true);
  });
});
