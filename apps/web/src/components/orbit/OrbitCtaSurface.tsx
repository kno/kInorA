import type * as React from "react";
import styles from "./orbit-primitives.module.css";
import { OrbitCard } from "./OrbitCard";

export interface OrbitCtaSurfaceProps extends React.ComponentPropsWithoutRef<"section"> {
  eyebrow?: string;
  title: string;
  description: string;
  actions: React.ReactNode;
}

export function OrbitCtaSurface({
  eyebrow,
  title,
  description,
  actions,
  className,
  ...props
}: OrbitCtaSurfaceProps) {
  return (
    <OrbitCard as="section" tone="surface-2" className={className} {...props}>
      <div className={styles.stack}>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.description}>{description}</p>
        <div className={styles.actions}>{actions}</div>
      </div>
    </OrbitCard>
  );
}
