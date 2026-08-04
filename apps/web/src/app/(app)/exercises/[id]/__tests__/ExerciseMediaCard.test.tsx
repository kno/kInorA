// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { catalogs } from "@kinora/i18n";
import { renderWithIntl } from "@/test-utils/render-with-intl";
import { ExerciseMediaCard } from "../ExerciseMediaCard";

// Production shape: the still is SELF-HOSTED and app-absolute, the animation
// is an absolute CROSS-ORIGIN CDN URL pinned to a dataset commit SHA. Keep
// both forms here — a fixture where the two share an origin would be
// self-consistent and would hide any re-rooting bug.
const props = {
  name: "bench press",
  imagePath: "/exercises/images/0001-abc.jpg",
  gifPath:
    "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/0001-abc.gif",
};

/**
 * Put every `<img>` into a given load state BEFORE React mounts, the way the
 * browser would have after fetching the server-rendered `src`. jsdom never
 * actually loads images, so these accessors have to be stubbed to reproduce a
 * pre-hydration outcome.
 *
 * Crucially this dispatches NO React `onError` — which is precisely the
 * production case the `onError` handler cannot see, because the DOM event
 * fired and was discarded before React attached its listener.
 */
function stubImageLoadState(complete: boolean, naturalWidth: number) {
  vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(complete);
  vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(naturalWidth);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ExerciseMediaCard", () => {
  it("shows the animated demonstration first", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    expect(screen.getByRole("img").getAttribute("src")).toBe(props.gifPath);
    expect(screen.getByText("Movement demonstration")).toBeDefined();
  });

  it("labels the media with the exercise name", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);
    expect(screen.getByAltText("Technique demonstration of bench press")).toBeDefined();
  });

  it("lazy-loads the media (plain <img>, this repo does not use next/image)", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);
    expect(screen.getByRole("img").getAttribute("loading")).toBe("lazy");
  });

  it("renders an absolute cross-origin gifPath VERBATIM — never re-rooted or prefixed", () => {
    // `gifPath` is opaque: it is currently a jsDelivr URL, but the component
    // must not know or care. Prepending the app origin, stripping the scheme,
    // or "normalizing" a missing leading slash would silently 404 every
    // animation in production while every same-origin fixture kept passing.
    const cdnGif =
      "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/0002-xyz.gif";
    renderWithIntl(<ExerciseMediaCard {...props} gifPath={cdnGif} />);

    const src = screen.getByRole("img").getAttribute("src");
    expect(src).toBe(cdnGif);
    expect(src).not.toContain("localhost");
    expect(src?.startsWith("https://cdn.jsdelivr.net/")).toBe(true);
  });

  it("keeps the two origins independent — the still stays app-absolute", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Position" }));

    // The still is self-hosted; switching away from the CDN animation must not
    // carry the CDN origin across.
    expect(screen.getByRole("img").getAttribute("src")).toBe("/exercises/images/0001-abc.jpg");
  });

  it("swaps to the still frame when 'Position' is selected", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Position" }));

    expect(screen.getByRole("img").getAttribute("src")).toBe(props.imagePath);
    expect(screen.getByText("Reference position")).toBeDefined();
  });

  it("swaps back to the animation when 'Movement' is selected", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Position" }));
    fireEvent.click(screen.getByRole("button", { name: "Movement" }));

    expect(screen.getByRole("img").getAttribute("src")).toBe(props.gifPath);
  });

  it("keeps showing the animation when it loads fine (no fallback, toggle enabled)", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    expect(screen.getByRole("img").getAttribute("src")).toBe(props.gifPath);
    expect(screen.getByRole("button", { name: "Movement" })).toHaveProperty("disabled", false);
    expect(screen.queryByText(/Animation unavailable/)).toBeNull();
  });

  it("falls back to the self-hosted still when the cross-origin animation fails to load", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    fireEvent.error(screen.getByRole("img"));

    expect(screen.getByRole("img").getAttribute("src")).toBe(props.imagePath);
    expect(screen.getByText(/Animation unavailable/)).toBeDefined();
  });

  it("does not claim to be showing an animation once it has fallen back", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    fireEvent.error(screen.getByRole("img"));

    // Movement is genuinely unavailable, so it is neither pressed nor clickable
    // and Position — what is actually on screen — reads as the active mode.
    const movement = screen.getByRole("button", { name: "Movement" });
    expect(movement).toHaveProperty("disabled", true);
    expect(movement.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Position" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("does not retry a gifPath that already failed, even after toggling back", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    fireEvent.error(screen.getByRole("img"));
    fireEvent.click(screen.getByRole("button", { name: "Position" }));

    expect(screen.getByRole("img").getAttribute("src")).toBe(props.imagePath);
  });

  it("does NOT leak the failed state to a different exercise's gifPath", () => {
    // The regression a boolean `hasFailed` would cause: every exercise opened
    // after one CDN failure would silently show the still, never retrying its
    // own animation.
    const { rerender } = renderWithIntl(<ExerciseMediaCard {...props} />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img").getAttribute("src")).toBe(props.imagePath);

    const nextGif =
      "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/0099-new.gif";
    // Re-rendered WITH the provider: RTL's `rerender` replaces the whole tree,
    // so dropping it here would strip the intl context the component needs.
    // Same tree position, so the component keeps its state — which is exactly
    // what this test needs to observe.
    rerender(
      <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="UTC">
        <ExerciseMediaCard {...props} gifPath={nextGif} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("img").getAttribute("src")).toBe(nextGif);
    expect(screen.getByRole("button", { name: "Movement" })).toHaveProperty("disabled", false);
    expect(screen.queryByText(/Animation unavailable/)).toBeNull();
  });

  it("falls back when the animation ALREADY failed before hydration (no onError ever fires)", () => {
    // The real-world case: the CDN is down when the user opens the page. The
    // server-rendered <img> starts fetching immediately, the DOM error event
    // fires and is gone before React attaches onError.
    stubImageLoadState(true, 0);

    renderWithIntl(<ExerciseMediaCard {...props} />);

    expect(screen.getByRole("img").getAttribute("src")).toBe(props.imagePath);
    expect(screen.getByText(/Animation unavailable/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Movement" })).toHaveProperty("disabled", true);
  });

  it("does not false-positive on an animation that simply has not finished loading", () => {
    // `naturalWidth === 0` on its own is ambiguous — an in-flight image also
    // reports zero. Only `complete && naturalWidth === 0` means failed.
    stubImageLoadState(false, 0);

    renderWithIntl(<ExerciseMediaCard {...props} />);

    expect(screen.getByRole("img").getAttribute("src")).toBe(props.gifPath);
    expect(screen.getByRole("button", { name: "Movement" })).toHaveProperty("disabled", false);
    expect(screen.queryByText(/Animation unavailable/)).toBeNull();
  });

  it("does not treat a fully loaded animation as failed", () => {
    stubImageLoadState(true, 360);

    renderWithIntl(<ExerciseMediaCard {...props} />);

    expect(screen.getByRole("img").getAttribute("src")).toBe(props.gifPath);
    expect(screen.getByRole("button", { name: "Movement" })).toHaveProperty("disabled", false);
  });

  it("re-checks on a gifPath change and does not leak a pre-hydration failure", () => {
    stubImageLoadState(true, 0);
    const { rerender } = renderWithIntl(<ExerciseMediaCard {...props} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe(props.imagePath);

    // The next exercise's animation is healthy — it must be given its own try.
    vi.restoreAllMocks();
    stubImageLoadState(false, 0);
    const nextGif =
      "https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/videos/0100-next.gif";
    rerender(
      <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="UTC">
        <ExerciseMediaCard {...props} gifPath={nextGif} />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("img").getAttribute("src")).toBe(nextGif);
    expect(screen.getByRole("button", { name: "Movement" })).toHaveProperty("disabled", false);
  });

  it("never inspects the STILL for a pre-hydration failure", () => {
    // Position mode shows the self-hosted still. Even with every image
    // reporting failed, the animation must not be blamed for it.
    stubImageLoadState(true, 0);
    const { rerender } = renderWithIntl(<ExerciseMediaCard {...props} gifPath={props.gifPath} />);

    vi.restoreAllMocks();
    stubImageLoadState(false, 0);
    rerender(
      <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="UTC">
        <ExerciseMediaCard {...props} gifPath="https://cdn.jsdelivr.net/gh/x/y@1/videos/0200-a.gif" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Position" }));

    // Now flip every image to "failed" while the STILL is on screen, and move
    // to a third exercise so the ref callback re-runs against that still.
    vi.restoreAllMocks();
    stubImageLoadState(true, 0);
    rerender(
      <NextIntlClientProvider locale="en" messages={catalogs.en} timeZone="UTC">
        <ExerciseMediaCard {...props} gifPath="https://cdn.jsdelivr.net/gh/x/y@1/videos/0300-b.gif" />
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("button", { name: "Movement" })).toHaveProperty("disabled", false);
  });

  it("does not disable the animation when the STILL is the image that failed", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Position" }));
    fireEvent.error(screen.getByRole("img"));

    // A broken still must not be misattributed to the animation.
    expect(screen.getByRole("button", { name: "Movement" })).toHaveProperty("disabled", false);

    fireEvent.click(screen.getByRole("button", { name: "Movement" }));
    expect(screen.getByRole("img").getAttribute("src")).toBe(props.gifPath);
  });

  it("reflects the active mode on the toggle buttons", () => {
    renderWithIntl(<ExerciseMediaCard {...props} />);

    expect(screen.getByRole("button", { name: "Movement" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Position" }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Position" }));

    expect(screen.getByRole("button", { name: "Movement" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Position" }).getAttribute("aria-pressed")).toBe("true");
  });
});
