import type * as React from "react";
import styles from "./orbit-primitives.module.css";

export interface OrbitCardProps extends React.ComponentPropsWithoutRef<"article"> {
  as?: "article" | "div" | "section";
  tone?: "surface" | "surface-2";
}

export function OrbitCard({
  as = "article",
  tone = "surface",
  className,
  children,
  ...props
}: React.PropsWithChildren<OrbitCardProps>) {
  const Component = as;
  const classes = [styles.card, tone === "surface-2" ? styles.cardElevated : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <Component className={classes} {...props}>
      {children}
    </Component>
  );
}
