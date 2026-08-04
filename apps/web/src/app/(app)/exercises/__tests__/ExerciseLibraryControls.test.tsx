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
    // A chip click leaves the applied term untouched, so nothing may disturb
    // what the reader is mid-way through typing — text or caret.
    const { rerender } = render(
      withIntl(<ExerciseLibraryControls facets={facets} selected={{}} search="press" />),
    );
    const box = () => screen.getByLabelText("Search exercises") as HTMLInputElement;

    box().focus();
    fireEvent.change(box(), { target: { value: "press up" } });
    rerender(
      withIntl(
        <ExerciseLibraryControls facets={facets} selected={{ bodyPart: "chest" }} search="press" />,
      ),
    );

    expect(box().value).toBe("press up");
    expect(document.activeElement).toBe(box());
  });

  it("renders a chip per facet value, with its match count", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    expect(screen.getByRole("button", { name: /Chest/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Barbell/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /12/ })).toBeDefined();
  });

  it("translates the chip LABEL but filters by the RAW catalog value", () => {
    // The label is display copy; the value is an API contract. Sending
    // "?bodyPart=Pecho" would 400 — the taxonomy must never leak into the URL.
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.click(screen.getByRole("button", { name: /Chest/ }));

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
    expect(screen.getByRole("button", { name: /Exosuit/ })).toBeDefined();
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

  it("marks the applied filter's chip as pressed", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{ bodyPart: "chest" }} />);
    expect(screen.getByRole("button", { name: /Chest/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Back/ }).getAttribute("aria-pressed")).toBe("false");
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

  it("carries the active filters as hidden fields so a search COMPOSES with them", () => {
    const { container } = renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: "chest" }}
        preserved={{ bodyPart: "chest", title: "Bench Press" }}
      />,
    );

    const hidden = Object.fromEntries(
      [...container.querySelectorAll("form.kin-ex-search input[type=hidden]")].map((el) => [
        el.getAttribute("name"),
        el.getAttribute("value"),
      ]),
    );
    expect(hidden).toEqual({ bodyPart: "chest", title: "Bench Press" });
  });

  it("never carries offset, so a new search restarts at page 1", () => {
    const { container } = renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: "chest" }}
        preserved={{ bodyPart: "chest" }}
      />,
    );

    expect(container.querySelector("input[name=offset]")).toBeNull();
  });

  it("produces the composed URL a native submit would, with a filter active", () => {
    // What the browser itself builds from method + action + the form's fields.
    const { container } = renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: "chest" }}
        preserved={{ bodyPart: "chest" }}
      />,
    );
    const form = container.querySelector("form.kin-ex-search") as HTMLFormElement;
    (form.querySelector("input[name=search]") as HTMLInputElement).value = "squat";

    const query = new URLSearchParams(new FormData(form) as unknown as string[][]);
    expect(`${form.getAttribute("action")}?${query}`).toBe(
      "/exercises?bodyPart=chest&search=squat",
    );
  });

  it("navigates with the search term on submit (server-side filtering)", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "  press  " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?search=press");
  });

  it("drops the search parameter when the box is submitted empty", () => {
    currentSearch = "search=press";
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} search="press" />);

    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    // Clears the term outright rather than navigating to a dangling `?search=`.
    expect(routerPush).toHaveBeenCalledWith("/exercises");
  });

  it("composes the search with an active filter on the hydrated path too", () => {
    currentSearch = "bodyPart=chest";
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: "chest" }}
        preserved={{ bodyPart: "chest" }}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "squat" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?bodyPart=chest&search=squat");
  });

  it("resets the offset when a new search is submitted", () => {
    currentSearch = "bodyPart=chest&offset=48";
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: "chest" }}
        preserved={{ bodyPart: "chest" }}
        search="press"
      />,
    );

    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "squat" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?bodyPart=chest&search=squat");
  });

  it("applies a filter when its chip is clicked", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.click(screen.getByRole("button", { name: /Chest/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?bodyPart=chest");
  });

  it("clears the filter when the active chip is clicked again (toggle)", () => {
    currentSearch = "bodyPart=chest";
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{ bodyPart: "chest" }} />);

    fireEvent.click(screen.getByRole("button", { name: /Chest/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises");
  });

  it("resets the pagination offset whenever the result set changes", () => {
    currentSearch = "offset=48";
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.click(screen.getByRole("button", { name: /Barbell/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?equipment=barbell");
  });

  it("preserves unrelated query parameters such as ?title= (history reference)", () => {
    currentSearch = "title=Bench+Press";
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.click(screen.getByRole("button", { name: /Chest/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?title=Bench+Press&bodyPart=chest");
  });

  it("hides the clear-filters button when nothing is applied", () => {
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("clears the search and every filter, keeping unrelated parameters", () => {
    currentSearch = "title=Bench+Press&search=press&bodyPart=chest&equipment=barbell&target=pectorals";
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: "chest", equipment: "barbell", target: "pectorals" }}
        search="press"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?title=Bench+Press");
  });
});
