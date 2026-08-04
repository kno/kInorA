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

    expect(screen.getByRole("link", { name: /Chest/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /Barbell/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /12/ })).toBeDefined();
  });

  it("translates the chip LABEL but filters by the RAW catalog value", () => {
    // The label is display copy; the value is an API contract. Sending
    // "?bodyPart=Pecho" would 400 — the taxonomy must never leak into the URL.
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.click(screen.getByRole("link", { name: /Chest/ }));

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
    expect(screen.getByRole("link", { name: /Exosuit/ })).toBeDefined();
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

  it("marks the applied filter's chip as current", () => {
    // `aria-pressed` is a BUTTON state and is not valid on a link, so the
    // applied chip announces itself with `aria-current` instead.
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{ bodyPart: "chest" }} />);
    expect(screen.getByRole("link", { name: /Chest/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("link", { name: /Back/ }).getAttribute("aria-current")).toBeNull();
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

    fireEvent.click(screen.getByRole("link", { name: /Chest/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?bodyPart=chest");
  });

  it("clears the filter when the active chip is clicked again (toggle)", () => {
    currentSearch = "bodyPart=chest";
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{ bodyPart: "chest" }} />);

    fireEvent.click(screen.getByRole("link", { name: /Chest/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises");
  });

  it("resets the pagination offset whenever the result set changes", () => {
    currentSearch = "offset=48";
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.click(screen.getByRole("link", { name: /Barbell/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?equipment=barbell");
  });

  it("preserves unrelated query parameters such as ?title= (history reference)", () => {
    currentSearch = "title=Bench+Press";
    renderWithIntl(<ExerciseLibraryControls facets={facets} selected={{}} />);

    fireEvent.click(screen.getByRole("link", { name: /Chest/ }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?title=Bench+Press&bodyPart=chest");
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
        selected={{ bodyPart: "chest", equipment: "barbell", target: "pectorals" }}
        search="press"
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Clear filters" }));

    expect(routerPush).toHaveBeenCalledWith("/exercises?title=Bench+Press");
  });

  // --- The chips must WORK WITHOUT JAVASCRIPT, like the form beside them ---
  //
  // They were `type="button"` elements carrying only an `onClick`, sitting
  // OUTSIDE the search form. With JavaScript off, clicking a body-part chip or
  // "Clear filters" did nothing at all, while the search box next to them
  // navigated perfectly — one toolbar honouring two different contracts.
  //
  // These assert the DECLARATIVE `href` the browser acts on by itself; firing a
  // synthetic React click assumes hydration and can never catch this.

  it("renders each chip as a real link, not a bare button", () => {
    renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{}} carried={{}} />,
    );

    const chip = screen.getByRole("link", { name: /Chest/ });
    expect(chip.tagName).toBe("A");
    expect(chip.getAttribute("href")).toBe("/exercises?bodyPart=chest");
  });

  it("builds the chip href from the server-rendered params, keeping the search and ?title=", () => {
    // The href must be composed from props, NOT from `useSearchParams()`:
    // hooks have not run when there is no JavaScript, but this markup is what
    // the server already sent.
    currentSearch = "";
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{}}
        search="press"
        carried={{ title: "Bench Press", search: "press" }}
      />,
    );

    expect(screen.getByRole("link", { name: /Chest/ }).getAttribute("href")).toBe(
      "/exercises?title=Bench+Press&search=press&bodyPart=chest",
    );
  });

  it("points the ACTIVE chip's href at removing that filter (toggle without JS)", () => {
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: "chest" }}
        carried={{ bodyPart: "chest", equipment: "barbell" }}
      />,
    );

    expect(screen.getByRole("link", { name: /Chest/ }).getAttribute("href")).toBe(
      "/exercises?equipment=barbell",
    );
  });

  it("gives Clear filters a real href that drops the search and every filter", () => {
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: "chest", equipment: "barbell", target: "pectorals" }}
        search="press"
        carried={{
          title: "Bench Press",
          search: "press",
          bodyPart: "chest",
          equipment: "barbell",
          target: "pectorals",
          lang: "es",
        }}
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
        selected={{ bodyPart: "chest" }}
        carried={{ bodyPart: "chest" }}
      />,
    );

    expect(screen.getByRole("link", { name: "Clear filters" }).getAttribute("href")).toBe(
      "/exercises",
    );
  });

  it("still SOFT-navigates when JavaScript is live, rather than reloading the page", () => {
    // The href is the no-JS fallback; hydrated, the click must be intercepted
    // so the route is not fetched from scratch.
    currentSearch = "";
    renderWithIntl(
      <ExerciseLibraryControls facets={facets} selected={{}} carried={{}} />,
    );

    // `fireEvent` answers false when the handler called preventDefault.
    expect(fireEvent.click(screen.getByRole("link", { name: /Chest/ }))).toBe(false);
    expect(routerPush).toHaveBeenCalledWith("/exercises?bodyPart=chest");
  });

  it("intercepts the Clear filters link too", () => {
    currentSearch = "bodyPart=chest";
    renderWithIntl(
      <ExerciseLibraryControls
        facets={facets}
        selected={{ bodyPart: "chest" }}
        carried={{ bodyPart: "chest" }}
      />,
    );

    expect(fireEvent.click(screen.getByRole("link", { name: "Clear filters" }))).toBe(false);
    expect(routerPush).toHaveBeenCalledWith("/exercises");
  });
});
