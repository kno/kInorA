"use client";

import type * as React from "react";
import styles from "./orbit-selectable-card.module.css";

export interface OrbitSelectableCardProps {
  /** Primary card name shown in the display font. */
  label: string;
  /** Optional supporting description under the label. */
  children?: React.ReactNode;
  /** Optional leading icon node (stroke icon from the Orbit set). */
  icon?: React.ReactNode;
  /** Whether this card is the active selection. */
  selected?: boolean;
  /** Invoked on click or keyboard activation while enabled. */
  onSelect?: () => void;
  /** Disables interaction and dims the card. */
  disabled?: boolean;
  /** Style hook. */
  className?: string;
  /**
   * Opt-in full-bleed media treatment. When provided, the node (typically an
   * `<img>`) fills the entire card as its background and the label is
   * overprinted on a legibility scrim. The icon box and description are not
   * rendered in this variant; selection is conveyed by the accent border and
   * `aria-pressed` only. Used by the equipment step.
   */
  mediaBackground?: React.ReactNode;
  /** Hides the check indicator (implied by, and default for, the media variant). */
  hideCheck?: boolean;
}

/**
 * OrbitSelectableCard — the selectable option card from the Open Design
 * `.option-card`/`.obj-card`. Used by the create-plan wizard steps (and
 * reusable by 08). Exposes `role="button"` with `aria-pressed` selection
 * state, supports click + Enter/Space activation, and blocks interaction
 * when disabled. Colors come from the OKLch tokens — none are hardcoded.
 */
export function OrbitSelectableCard({
  label,
  children,
  icon,
  selected = false,
  onSelect,
  disabled = false,
  className,
  mediaBackground,
  hideCheck,
}: OrbitSelectableCardProps) {
  const isMedia = mediaBackground != null;
  // The check is hidden explicitly, or implicitly whenever the media variant
  // is active (selection there is conveyed by the accent border alone).
  const showCheck = !(hideCheck ?? isMedia);

  const classes = [
    styles.card,
    isMedia ? styles.media : "",
    selected ? styles.selected : "",
    disabled ? styles.disabled : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const activate = () => {
    if (disabled) return;
    onSelect?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      activate();
    }
  };

  if (isMedia) {
    return (
      <div
        className={classes}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-pressed={selected}
        aria-disabled={disabled}
        onClick={activate}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.mediaFill} aria-hidden="true">
          {mediaBackground}
        </span>
        <span className={styles.mediaScrim} aria-hidden="true" />
        <span className={styles.mediaLabel}>{label}</span>
      </div>
    );
  }

  return (
    <div
      className={classes}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={selected}
      aria-disabled={disabled}
      onClick={activate}
      onKeyDown={handleKeyDown}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.name}>{label}</span>
      {children && <span className={styles.desc}>{children}</span>}
      {showCheck && (
        <span className={styles.check} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
    </div>
  );
}
