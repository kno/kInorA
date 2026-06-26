import type * as React from "react";
import styles from "./orbit-primitives.module.css";
import { KinIcon } from "@/components/icons";
import { OrbitCard } from "./OrbitCard";

interface OrbitNavAffordanceBase {
  label: string;
  description?: string;
  meta?: string;
  icon?: React.ReactNode;
}

type OrbitNavAffordanceProps =
  | (OrbitNavAffordanceBase & React.ComponentPropsWithoutRef<"a"> & { href: string })
  | (OrbitNavAffordanceBase & React.ComponentPropsWithoutRef<"div"> & { href?: undefined });

export function OrbitNavAffordance({
  label,
  description,
  meta,
  icon,
  className,
  href,
  ...props
}: OrbitNavAffordanceProps) {
  const content = (
    <OrbitCard as="div" tone="surface-2" className={[styles.navAffordance, className].filter(Boolean).join(" ")}>
      <div className={styles.row}>
        <div className={styles.icon}>{icon ?? <KinIcon name="forward" />}</div>
        <div className={styles.stack}>
          <strong>{label}</strong>
          {description ? <span className={styles.description}>{description}</span> : null}
          {meta ? <span className={styles.meta}>{meta}</span> : null}
        </div>
        <div className={styles.navArrow} aria-hidden="true">
          <KinIcon name="forward" size={20} />
        </div>
      </div>
    </OrbitCard>
  );

  if (href) {
    return (
      <a href={href} {...(props as React.ComponentPropsWithoutRef<"a">)}>
        {content}
      </a>
    );
  }

  return <div {...(props as React.ComponentPropsWithoutRef<"div">)}>{content}</div>;
}
