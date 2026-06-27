"use client";

import { useEffect, useState } from "react";
import type * as React from "react";
import styles from "./orbit-primitives.module.css";

const RADIUS = 16;
/** Circumference of the r=16 ring — matches the icons.html mechanic (≈100.53). */
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const VIEWBOX = 48;

export interface OrbitProgressProps {
  /** Current progress amount. Ignored when `indeterminate`. */
  value?: number;
  /** Denominator. Fraction p = clamp(value/max, 0, 1). */
  max?: number;
  /** Rendered px (width = height). The viewBox stays 0 0 48 48 and the SVG scales. */
  size?: number;
  /** Show the rounded p*100% number in the center readout. */
  showPercent?: boolean;
  /** Small uppercase caption under the readout (e.g. "Session"). */
  label?: string;
  /** Custom center content; overrides showPercent/label. */
  children?: React.ReactNode;
  /** Continuous spin for loaders/splash (no fixed value); honors reduced-motion. */
  indeterminate?: boolean;
  /** Style hook. */
  className?: string;
  /** Accessible name; the component sets role="progressbar" + aria-valuemin/max/now. */
  "aria-label"?: string;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Reads the user's reduced-motion preference. Defaults to `false` on the
 * server and on the first client render (so SSR markup is stable), then
 * syncs to the real media query after mount.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}

/**
 * OrbitProgress — the reusable Orbit-logo progress ring.
 *
 * Replicates the authoritative `docs/open-design/kinora/icons.html` mechanic:
 * a static track ring, a gray arc that grows from 12 o'clock clockwise
 * (`stroke-dasharray = C`, `stroke-dashoffset = C * (1 - p)`), and a lime ball
 * at the arc head (a `<g>` rotated by `p * 360deg`, `transform-origin: 24px 24px`).
 * The center readout shows custom children, else the rounded percent, else nothing.
 *
 * General-purpose: the create-plan wizard is its first consumer
 * (`value=step-1, max=total-1` with a "N / 6" readout) but it also serves AI
 * loaders, session progress, and streak rings. Animations honor
 * `prefers-reduced-motion`.
 */
export function OrbitProgress({
  value = 0,
  max = 100,
  size = 200,
  showPercent = false,
  label,
  children,
  indeterminate = false,
  className,
  "aria-label": ariaLabel,
}: OrbitProgressProps) {
  const reducedMotion = usePrefersReducedMotion();

  const p = indeterminate || max <= 0 ? 0 : clamp01(value / max);
  // In indeterminate mode use a fixed ~75% arc so the spinning segment is visible.
  // In determinate mode the offset is derived from progress as usual.
  const dashoffset = indeterminate
    ? (CIRCUMFERENCE * 0.25).toFixed(2)
    : (CIRCUMFERENCE * (1 - p)).toFixed(2);
  const rotation = (p * 360).toFixed(0);
  const transition = reducedMotion ? "none" : "stroke-dashoffset .3s ease";
  const ballTransition = reducedMotion ? "none" : "transform .3s ease";

  const wrapClasses = [styles.orbitWrap, className].filter(Boolean).join(" ");
  const arcClasses = [
    styles.orbitArc,
    indeterminate && !reducedMotion ? styles.orbitSpin : "",
  ]
    .filter(Boolean)
    .join(" ");

  const center = children
    ? children
    : showPercent
      ? Math.round(p * 100)
      : null;

  return (
    <div
      className={wrapClasses}
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : value}
      aria-busy={indeterminate ? true : undefined}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        fill="none"
        aria-hidden="true"
      >
        {/* Static track ring */}
        <circle
          className={styles.orbitTrack}
          cx={24}
          cy={24}
          r={RADIUS}
          strokeWidth={4}
        />
        {/* Progress arc — grows from 12 o'clock clockwise */}
        <circle
          data-orbit="arc"
          className={arcClasses}
          cx={24}
          cy={24}
          r={RADIUS}
          strokeWidth={4}
          strokeLinecap="round"
          transform="rotate(-90 24 24)"
          style={{
            strokeDasharray: CIRCUMFERENCE.toFixed(2),
            strokeDashoffset: dashoffset,
            transition,
          }}
        />
        {/* Lime ball at the arc head — hidden in indeterminate mode (ball position is
            meaningless while the arc spins freely; only shown for determinate progress). */}
        {!indeterminate && (
          <g
            data-orbit="ball"
            className={styles.orbitBallGroup}
            style={{
              transformBox: "view-box",
              transformOrigin: "24px 24px",
              transform: `rotate(${rotation}deg)`,
              transition: ballTransition,
            }}
          >
            <circle className={styles.orbitBall} cx={24} cy={8} r={6} />
          </g>
        )}
      </svg>

      {center !== null && (
        <div className={styles.orbitReadout}>
          <div className={styles.orbitValue}>{center}</div>
          {label && <div className={styles.orbitLabel}>{label}</div>}
        </div>
      )}
    </div>
  );
}
