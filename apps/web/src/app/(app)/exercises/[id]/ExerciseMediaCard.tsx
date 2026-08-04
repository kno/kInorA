"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";

export interface ExerciseMediaCardProps {
  name: string;
  /**
   * Self-hosted still frame, app-absolute, e.g.
   * `/exercises/images/0001-2gPfomN.jpg` (served from
   * `apps/web/public/exercises/images/`).
   */
  imagePath: string;
  /**
   * Animation URL. OPAQUE — treat it as a ready-to-use `src` and nothing
   * more. It is currently an absolute cross-origin jsDelivr URL pinned to a
   * dataset commit SHA, e.g.
   * `https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@<sha>/videos/0001-2gPfomN.gif`,
   * NOT an app-absolute path. Never prepend an origin, never assume a leading
   * `/`, and never pattern-match on its shape: the hosting strategy has
   * already changed once and may change again.
   */
  gifPath: string;
}

type MediaMode = "movement" | "position";

/**
 * ExerciseMediaCard — the detail view's media panel with a movement/position
 * toggle (Open Design `screens/web-exercise-detail.html`).
 *
 * "Movement" shows the animated GIF, "position" the static still. The two
 * assets come from DIFFERENT origins: the still is self-hosted from
 * `public/exercises/images/`, while the animation is fetched cross-origin
 * from a CDN (see `gifPath` above). Both are © Gym visual — the
 * `ExerciseAttribution` block on the same page carries the required notice.
 *
 * Each path is passed through to `src` verbatim, which is what keeps this
 * component indifferent to where the media actually lives.
 *
 * RESILIENCE. The animation is third-party and cross-origin; the still is
 * ours and always available. If the CDN or the upstream repository fails, the
 * animation degrades to the still rather than rendering a broken image, and
 * the toggle stops offering a mode that cannot be delivered.
 *
 * The failure is remembered by URL, not as a bare boolean, so it does not
 * outlive the exercise it belongs to: a `useState(false)` would make every
 * exercise visited AFTER the first failure show the still, even though its
 * own animation was never tried.
 *
 * Plain `<img loading="lazy">`: this repo does not use `next/image`.
 */
export function ExerciseMediaCard({ name, imagePath, gifPath }: ExerciseMediaCardProps) {
  const t = useTranslations();
  const [mode, setMode] = useState<MediaMode>("movement");
  // The exact `gifPath` that failed to load — NOT a boolean. Comparing it to
  // the current prop is what scopes the failure to one exercise.
  const [failedGifPath, setFailedGifPath] = useState<string | null>(null);

  const animationFailed = failedGifPath === gifPath;
  // "Movement" is only ever the EFFECTIVE mode when an animation can actually
  // be shown, so every downstream flag below stays truthful by construction.
  const isMovement = mode === "movement" && !animationFailed;

  const label = animationFailed
    ? t("exercises.detail.media.unavailable")
    : isMovement
      ? t("exercises.detail.media.movementLabel")
      : t("exercises.detail.media.positionLabel");

  function handleMediaError() {
    // Guarded by `isMovement` so a failing STILL is never misattributed to the
    // animation (which would wrongly disable the movement toggle).
    if (isMovement) setFailedGifPath(gifPath);
  }

  /**
   * Catch an animation that had ALREADY failed before React attached
   * `onError`.
   *
   * This page is server-rendered, so the browser begins fetching the CDN
   * animation from the initial HTML — well before hydration. "The CDN is down
   * when the user opens the page" therefore fires the DOM `error` event and
   * lets it go unobserved: by the time React attaches its handler the event is
   * gone, and `onError` alone would leave a broken image on screen with the
   * movement toggle still enabled.
   *
   * A ref callback runs at DOM-attach time (before paint), so it corrects the
   * state at the earliest point React can. `complete` alone is NOT sufficient —
   * a successfully decoded image is also `complete`. Zero `naturalWidth` is
   * what separates a failed decode from a finished one; `complete === false`
   * means the fetch is still in flight, which is the `onError` path's job.
   *
   * Depends on `gifPath` so navigating to another exercise re-checks against
   * the new image, and on `isMovement` so the STILL is never inspected and
   * misattributed to the animation.
   */
  const checkForPreHydrationFailure = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !isMovement) return;
      if (img.complete && img.naturalWidth === 0) setFailedGifPath(gifPath);
    },
    [gifPath, isMovement]
  );

  return (
    <article className="kin-ex-media">
      <span className="kin-ex-media__label">{label}</span>
      <img
        ref={checkForPreHydrationFailure}
        className="kin-ex-media__img"
        src={isMovement ? gifPath : imagePath}
        alt={t("exercises.detail.media.alt", { name })}
        loading="lazy"
        width={360}
        height={360}
        onError={handleMediaError}
      />
      <div className="kin-ex-media__toggle" role="group" aria-label={t("exercises.detail.media.toggleLabel")}>
        <button
          type="button"
          // Natively disabled rather than merely `aria-disabled`: the mode is
          // genuinely unavailable, so the control should not be clickable at
          // all, not just announced as inert.
          disabled={animationFailed}
          aria-pressed={isMovement}
          className={`kin-ex-media__mode${isMovement ? " kin-ex-media__mode--active" : ""}`}
          onClick={() => setMode("movement")}
        >
          {t("exercises.detail.media.movement")}
        </button>
        <button
          type="button"
          aria-pressed={!isMovement}
          className={`kin-ex-media__mode${isMovement ? "" : " kin-ex-media__mode--active"}`}
          onClick={() => setMode("position")}
        >
          {t("exercises.detail.media.position")}
        </button>
      </div>
    </article>
  );
}
