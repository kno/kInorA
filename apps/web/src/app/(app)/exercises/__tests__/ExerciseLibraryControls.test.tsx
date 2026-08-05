// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { catalogs } from "@kinora/i18n";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import type { ExerciseLibraryFacets } from "../ExerciseLibraryControls";

/**
 * Local provider wrapper, mirroring `ExerciseCard.test.tsx`.
 *
 * `renderWithIntl` applies the provider around the element it is given, so its
 * `rerender` would drop it. Re-rendering with NEW PROPS is how a soft
 * navigation is simulated, so the two tests that need it wrap explicitly and
 * keep the tree shape identical across renders.
 */
function withIntl(ui: ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>
  );
}

// --- Module mocks ---

const routerPush = vi.fn();
let currentSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

import { ExerciseLibraryControls } from "../ExerciseLibraryControls";

afterEach(() => {
  vi.clearAllMocks();
  currentSearch = "";
});

// --- Test fixtures ---

const facets: ExerciseLibraryFacets = {
  bodyPart: [
    { value: "chest", count: 12 },
    { value: "back", count: 34 },
  ],
  equipment: [{ value: "barbell", count: 7 }],
  target: [{ value: "pectorals", count: 5 }],
};

// --- Tests ---

describe("ExerciseLibraryControls", () => {
  it("renders a search field seeded with the applied term", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} search="press" />);
    expect(screen.getByLabelText("Search exercises")).toHaveProperty("value", "press");
  });

  it("resets the search box when the applied term is cleared by a navigation", () => {
    // `router.push` is a SOFT navigation: this component stays mounted, so an
    // uncontrolled field seeded once by `defaultValue` kept the old term after
    // "Clear filters" — and pressing Search re-applied a filter the reader
    // believed cleared. The field must follow the URL.
    const { rerender } = render(withIntl(<ExerciseLibraryControls facets={facets} selected={{}} />));
    const box = () => screen.getByLabelText("Search exercises") as HTMLInputElement;

    // The reader types the term, which marks the field dirty.
    fireEvent.change(box(), { target: { value: "press" } });
    rerender(withIntl(<ExerciseLibraryControls facets={facets} selected={{}} search="press" />));
    expect(box().value).toBe("press");

    // "Clear filters" → /exercises → the server re-renders with no term.
    rerender(withIntl(<ExerciseLibraryControls facets={facets} selected={{}} />));
    expect(box().value).toBe("");
  });

  it("keeps FOCUS in the search box when the submitted term comes back applied", () => {
    // Making the field follow the URL by keying it on the applied term worked,
    // but at the cost of REMOUNTING the node on every submit: focus fell to
    // <body>, which on a phone closes the on-screen keyboard after each single
    // search. The field must track the URL without changing identity.
    const { rerender } = render(withIntl(<ExerciseLibraryControls facets={facets} selected={{}} />));
    const box = () => screen.getByLabelText("Search exercises") as HTMLInputElement;

    box().focus();
    fireEvent.change(box(), { target: { value: "press" } });
    fireEvent.submit(box().closest("form") as HTMLFormElement);

    // The soft navigation lands: the server re-renders with the term applied.
    rerender(withIntl(<ExerciseLibraryControls facets={facets} selected={{}} search="press" />));

    expect(routerPush).toHaveBeenCalledWith("/exercises?search=press");
    expect(box().value).toBe("press");
    expect(document.activeElement).toBe(box());
  });

  it("keeps the typed term AND focus while an unrelated filter navigation happens", () => {
    // A checkbox toggle leaves the applied term untouched, so nothing may
    // disturb what the reader is mid-way through typing — text or caret.
    const { rerender } = render(
      withIntl(<ExerciseLibraryControls facets={facets} selected={{}} search="press" />),
    );
    const box = () => screen.getByLabelText("Search exercises") as HTMLInputElement;

    box().focus();
    fireEvent.change(box(), { target: { value: "press up" } });
    rerender(
      withIntl(
        <ExerciseLibraryControls
          facets={facets}
          selected={{ bodyPart: ["chest"] }}
          search="press"
        />,
      ),
    );

    expect(box().value).toBe("press up");
    expect(document.activeElement).toBe(box());
  });

  it("renders a checkbox per facet value, with its match count", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    expect(screen.getByRole("checkbox", { name: /Chest/ })).toBeDefined();
    expect(screen.getByRole("checkbox", { name: /Barbell/ })).toBeDefined();
    expect(screen.getByRole("checkbox", { name: /12/ })).toBeDefined();
  });

  it("the checkbox input carries the .kin-visually-hidden utility class", () => {
    // The focusable, submittable element is the checkbox itself now, not the
    // wrapping label — it must be visually hidden while remaining in the
    // accessibility tree and keyboard-focusable.
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);
    expect(screen.getByRole("checkbox", { name: /Chest/ }).className).toContain(
      "kin-visually-hidden",
    );
  });

  it("translates the chip LABEL but filters by the RAW catalog value", () => {
    // The label is display copy; the value is an API contract. Sending
    // "?bodyPart=Pecho" would 400 — the taxonomy must never leak into the URL.
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Chest/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?bodyPart=chest");
  });

  it("falls back to the raw value for a facet term with no translation", () => {
    renderWithIntl(
      <ExerciseLibraryControls
        facets={{ bodyPart: [{ value: "exosuit", count: 2 }], equipment: [], target: [] }}
        selected={{}}
      />,
    );

    // Capitalised, never blank and never an `exercises.taxonomy.*` key path.
    expect(screen.getByRole("checkbox", { name: /Exosuit/ })).toBeDefined();
    expect(screen.queryByText(/exercises\.taxonomy/)).toBeNull();
  });

  it("omits a facet group the API returned empty", () => {
    renderWithIntl(
      <ExerciseLibraryControls
        facets={{ bodyPart: facets.bodyPart, equipment: [], target: [] }}
        selected={{}}
      />,
    );

    expect(screen.queryByText("Equipment")).toBeNull();
    expect(screen.getByText("Body part")).toBeDefined();
  });

  it("renders the applied filter's checkbox as checked", () => {
    renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{ bodyPart: ["chest"] }} />,
    );
    expect((screen.getByRole("checkbox", { name: /Chest/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("checkbox", { name: /Back/ }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  it("renders a ZERO-COUNT selected value as still checked (spec: it stays visible)", () => {
    // The API keeps a selected value in the response with `count: 0` when
    // narrowing has excluded every matching record. It must still render, and
    // still show as applied.
    renderWithIntl(
      <ExerciseLibraryControls
        facets={{ bodyPart: [{ value: "chest", count: 0 }], equipment: [], target: [] }}
        selected={{ bodyPart: ["chest"] }}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /Chest/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(screen.getByText("0")).toBeDefined();
  });

  it("marks each facet group with role=\"group\" and an accessible name, not a fieldset", () => {
    // `<fieldset>`/`<legend>` fight the existing responsive grid layout; a
    // labelled group is the correct, lighter-weight grouping for checkboxes.
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);
    const group = screen.getByRole("group", { name: "Body part" });
    expect(group.tagName).not.toBe("FIELDSET");
  });

  it("selects MULTIPLE values within the same group — the whole point of additive filtering", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{ bodyPart: ["chest"] }} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /Back/ }));

    // JOINED into ONE occurrence, never a repeated key: the checkboxes submit
    // `bodyPart` twice (that is what a native multi-checkbox form does), but a
    // pushed URL where one key repeats is invisible to Next's client router
    // cache, which then re-renders the PREVIOUS results (#345). See
    // `facet-values.ts`. The e2e spec proves the render actually follows —
    // this only pins the URL shape that makes it possible.
    expect(routerPush).toHaveBeenCalledWith("/exercises?bodyPart=chest%2Cback");
  });

  it("unchecks one value without clearing the rest of the same group", () => {
    renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{ bodyPart: ["chest", "back"] }} />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Chest/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?bodyPart=back");
  });

  // --- The form must WORK WITHOUT JAVASCRIPT ---
  //
  // The original bug: the form carried only an `onSubmit` handler, no `action`
  // or `method`. Submitting therefore did nothing at all unless this client
  // component had hydrated. The old tests passed anyway, because firing a
  // synthetic React submit event assumes hydration by construction. These
  // assert the DECLARATIVE contract the browser acts on by itself.

  it("is a real GET form targeting the library route", () => {
    const { container } = renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{}} />,
    );
    const form = container.querySelector("form.kin-ex-search") as HTMLFormElement;

    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/exercises");
  });

  it("submits the search box under the name the server reads", () => {
    const { container } = renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{}} />,
    );
    const input = container.querySelector("input[name=search]") as HTMLInputElement;

    expect(input).not.toBeNull();
    expect(input.type).toBe("search");
  });

  it("carries only the non-facet params as hidden fields — the checkboxes contribute the rest", () => {
    const { container } = renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: ["chest"] }}
        preserved={[["title", "Bench Press"]]}
      />,
    );

    const hidden = [...container.querySelectorAll("form.kin-ex-search input[type=hidden]")].map(
      (el) => [el.getAttribute("name"), el.getAttribute("value")],
    );
    expect(hidden).toEqual([["title", "Bench Press"]]);
  });

  it("never carries offset, so a new search restarts at page 1", () => {
    const { container } = renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: ["chest"] }}
        preserved={[["title", "Bench Press"]]}
      />,
    );

    expect(container.querySelector("input[name=offset]")).toBeNull();
  });

  it("both facet checkboxes AND the always-rendered Apply filters submit exist inside the same form", () => {
    const { container } = renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{}} />,
    );
    const form = container.querySelector("form.kin-ex-search") as HTMLFormElement;

    expect(form.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Apply filters" }).closest("form")).toBe(form);
  });

  it("produces the composed URL a native submit would, with a filter checked", () => {
    // What the browser itself builds from method + action + the form's own
    // fields — no synthetic event, no handler.
    const { container } = renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{ bodyPart: ["chest"] }} />,
    );
    const form = container.querySelector("form.kin-ex-search") as HTMLFormElement;
    (form.querySelector("input[name=search]") as HTMLInputElement).value = "squat";

    const query = new URLSearchParams(new FormData(form) as unknown as string[][]);
    expect(`${form.getAttribute("action")}?${query}`).toBe(
      "/exercises?search=squat&bodyPart=chest",
    );
  });

  it("a no-JS submit emits REPEATED bodyPart pairs for a multi-value selection", () => {
    const { container } = renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: ["chest", "back"] }}
      />,
    );
    const form = container.querySelector("form.kin-ex-search") as HTMLFormElement;

    const params = new URLSearchParams(new FormData(form) as unknown as string[][]);
    expect(params.getAll("bodyPart")).toEqual(["chest", "back"]);
  });

  it("navigates with the search term on submit (server-side filtering)", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "  press  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?search=press");
  });

  it("drops the search parameter when the box is submitted empty", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} search="press" />);

    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // Clears the term outright rather than navigating to a dangling `?search=`.
    expect(routerPush).toHaveBeenCalledWith("/exercises");
  });

  it("composes the search with an active filter checkbox on submit", () => {
    renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{ bodyPart: ["chest"] }} />,
    );

    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "squat" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?search=squat&bodyPart=chest");
  });

  it("never emits offset when the search is submitted, even if the current URL has one", () => {
    currentSearch = "bodyPart=chest&offset=48";
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: ["chest"] }}
        search="press"
      />,
    );

    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "squat" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    const [url] = routerPush.mock.calls[0] as [string];
    expect(url).not.toContain("offset");
  });

  it("hides the clear-filters button when nothing is applied", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);
    expect(screen.queryByRole("link", { name: "Clear filters" })).toBeNull();
  });

  it("clears the search and every filter, keeping unrelated parameters", () => {
    currentSearch = "title=Bench+Press&search=press&bodyPart=chest&equipment=barbell&target=pectorals";
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: ["chest"], equipment: ["barbell"], target: ["pectorals"] }}
        search="press"
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Clear filters" }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?title=Bench+Press");
  });

  // --- Focus after auto-submit (design §7 / #343's lesson applied literally) ---

  it("KEEPS FOCUS on the toggled checkbox once the auto-submitted navigation lands", () => {
    // Toggling a checkbox calls `form.requestSubmit()`, which soft-navigates
    // via `router.push` — this component stays mounted. Checkboxes are keyed
    // on `${field}:${value}`, never on `selected`, so nothing in this tree
    // remounts when the server re-renders with the new selection. A stable
    // key is what keeps focus; #343 lost it precisely by remounting on
    // navigation, invisibly to a test that never checked `activeElement`.
    const { rerender } = render(
      withIntl(<ExerciseLibraryControls facets={facets} selected={{}} />),
    );
    const chestBox = () => screen.getByRole("checkbox", { name: /Chest/ }) as HTMLInputElement;

    chestBox().focus();
    fireEvent.click(chestBox());

    expect(routerPush).toHaveBeenCalledWith("/exercises?bodyPart=chest");

    // The soft navigation lands: the server re-renders with the filter applied.
    rerender(
      withIntl(<ExerciseLibraryControls facets={facets} selected={{ bodyPart: ["chest"] }} />),
    );

    expect(chestBox().checked).toBe(true);
    expect(document.activeElement).toBe(chestBox());
  });

  it("restores the true applied selection on a browser back navigation", () => {
    // The signature-based comparison must pick up a selection change even
    // though `selected` is a brand-new object literal on every render (a
    // Server Component parent never hands down the same reference twice).
    const { rerender } = render(
      withIntl(<ExerciseLibraryControls facets={facets} selected={{ bodyPart: ["chest"] }} />),
    );
    rerender(withIntl(<ExerciseLibraryControls facets={facets} selected={{}} />));

    expect((screen.getByRole("checkbox", { name: /Chest/ }) as HTMLInputElement).checked).toBe(
      false,
    );
  });

  // --- A modifier click on the clear-filters link belongs to the BROWSER ---
  //
  // Cmd/Ctrl+click, Shift+click and Alt+click all arrive as ordinary `click`
  // events, so a handler that calls `preventDefault()` unconditionally
  // swallows them and soft-navigates in the SAME tab — a link that refuses to
  // behave like one. Only a plain primary click may be intercepted. Checkboxes
  // have no navigation target, so this guard no longer applies to them
  // (design §7 retires `isPlainClick` for the facet controls).

  it.each([
    ["Cmd/Ctrl (new tab, macOS)", { metaKey: true }],
    ["Ctrl (new tab, Windows/Linux)", { ctrlKey: true }],
    ["Shift (new window)", { shiftKey: true }],
    ["Alt (save target)", { altKey: true }],
  ])("leaves a %s click on Clear filters to the browser", (_label, modifier) => {
    currentSearch = "bodyPart=chest";
    renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{ bodyPart: ["chest"] }} />,
    );

    // `fireEvent` answers true when nothing called preventDefault.
    expect(
      fireEvent.click(screen.getByRole("link", { name: "Clear filters" }), modifier),
    ).toBe(true);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("intercepts a plain click on Clear filters", () => {
    currentSearch = "bodyPart=chest";
    renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{ bodyPart: ["chest"] }} />,
    );

    expect(fireEvent.click(screen.getByRole("link", { name: "Clear filters" }))).toBe(false);
    expect(routerPush).toHaveBeenCalledWith("/exercises");
  });

  it("gives Clear filters a real href built from the server-rendered carried params", () => {
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: ["chest"], equipment: ["barbell"], target: ["pectorals"] }}
        search="press"
        carried={[
          ["title", "Bench Press"],
          ["search", "press"],
          ["bodyPart", "chest"],
          ["equipment", "barbell"],
          ["target", "pectorals"],
          ["lang", "es"],
        ]}
      />,
    );

    const clear = screen.getByRole("link", { name: "Clear filters" });
    expect(clear.tagName).toBe("A");
    // Only the library's OWN filters are dropped; `?title=` and `?lang=` are
    // not filters and must survive.
    expect(clear.getAttribute("href")).toBe("/exercises?title=Bench+Press&lang=es");
  });

  it("falls back to the bare route when clearing leaves nothing behind", () => {
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: ["chest"] }}
        carried={[["bodyPart", "chest"]]}
      />,
    );

    expect(screen.getByRole("link", { name: "Clear filters" }).getAttribute("href")).toBe(
      "/exercises",
    );
  });
});
