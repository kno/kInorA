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
}: OrbitSelectableCardProps) {
  const classes = [
    styles.card,
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

  return (
    <div
      className={classes}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={selected}
      aria-disabled={disabled}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
    >
      {icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.name}>{label}</span>
      {children && <span className={styles.desc}>{children}</span>}
      <span className={styles.check} aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
    </div>
  );
}
