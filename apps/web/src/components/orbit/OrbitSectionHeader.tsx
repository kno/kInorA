import type * as React from "react";
import styles from "./orbit-primitives.module.css";

export interface OrbitSectionHeaderProps extends React.ComponentPropsWithoutRef<"header"> {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  align?: "start" | "center";
}

export function OrbitSectionHeader({
  eyebrow,
  title,
  description,
  actions,
  align = "start",
  className,
  ...props
}: OrbitSectionHeaderProps) {
  const classes = [styles.header, align === "center" ? styles.headerCenter : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={classes} {...props}>
      <div className={styles.stack}>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <h2 className={styles.title}>{title}</h2>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
