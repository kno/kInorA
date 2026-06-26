import type * as React from "react";
import styles from "./orbit-primitives.module.css";
import { OrbitCard } from "./OrbitCard";

export interface OrbitMetricBlockProps extends React.ComponentPropsWithoutRef<"article"> {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
}

export function OrbitMetricBlock({
  label,
  value,
  hint,
  icon,
  className,
  ...props
}: OrbitMetricBlockProps) {
  return (
    <OrbitCard className={className} {...props}>
      <div className={styles.row}>
        {icon ? <div className={styles.icon}>{icon}</div> : null}
        <div className={styles.stack}>
          <span className={styles.eyebrow}>{label}</span>
          <strong className={styles.metricValue}>{value}</strong>
          {hint ? <span className={styles.hint}>{hint}</span> : null}
        </div>
      </div>
    </OrbitCard>
  );
}
