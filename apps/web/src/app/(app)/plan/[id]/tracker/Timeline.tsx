import { useTranslations } from "next-intl";
import type { TimelineEntry } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface TimelineProps {
  items: TimelineEntry[];
}

/** Session timeline: every exercise with a done/active/pending state + tag. */
export function Timeline({ items }: TimelineProps) {
  const t = useTranslations("tracker");
  return (
    <section
      className={`${styles.card} ${styles.timelineCard}`}
      aria-label={t("timeline.heading")}
    >
      <h3>{t("timeline.heading")}</h3>
      <div className={styles.timelineList}>
        {items.map((item) => {
          const itemCls =
            item.state === "done"
              ? styles.timelineItemDone
              : item.state === "active"
                ? styles.timelineItemActive
                : "";
          const meta =
            item.state === "done"
              ? t("timeline.meta.done", { n: item.setsCount })
              : item.state === "active"
                ? t("timeline.meta.active", { n: item.setsDone + 1, m: item.setsCount })
                : t("timeline.meta.pending", { n: item.setsCount });
          const tag =
            item.state === "done"
              ? t("timeline.done")
              : item.state === "active"
                ? t("timeline.now")
                : t("timeline.next");
          return (
            <div key={item.id} className={`${styles.timelineItem} ${itemCls}`}>
              <span className={styles.timelineIndex}>{item.index}</span>
              <div>
                <p className={styles.timelineName}>{item.title}</p>
                <p className={styles.timelineMeta}>{meta}</p>
              </div>
              <span className={styles.timelineTag}>{tag}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
