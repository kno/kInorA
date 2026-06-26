import type * as React from "react";
import styles from "./orbit-primitives.module.css";
import { KinIcon } from "@/components/icons";
import { OrbitCard } from "./OrbitCard";

export interface OrbitEmptyStateProps extends React.ComponentPropsWithoutRef<"section"> {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}

export function OrbitEmptyState({
  title,
  description,
  action,
  icon,
  className,
  ...props
}: OrbitEmptyStateProps) {
  return (
    <OrbitCard as="section" className={className} {...props}>
      <div className={styles.stack}>
        <div className={styles.icon}>{icon ?? <KinIcon name="info" decorative={false} title={title} />}</div>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.description}>{description}</p>
        {action ? <div className={styles.actions}>{action}</div> : null}
      </div>
    </OrbitCard>
  );
}
