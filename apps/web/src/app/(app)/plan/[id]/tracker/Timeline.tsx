import type { TimelineEntry, Translate } from "./tracker-model";
import styles from "../TrackerPanel.module.css";

interface TimelineProps {
  t: Translate;
  items: TimelineEntry[];
}

/** Session timeline: every exercise with a done/active/pending state + tag. */
export function Timeline({ t, items }: TimelineProps) {
  return (
    <section
      className={`${styles.card} ${styles.timelineCard}`}
      aria-label={t("tracker_timeline_heading", "Workout timeline")}
    >
      <h3>{t("tracker_timeline_heading", "Workout timeline")}</h3>
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
              ? t("tracker_timeline_meta_done", "{n} sets · completed").replace(
                  "{n}",
                  String(item.setsCount),
                )
              : item.state === "active"
                ? t("tracker_timeline_meta_active", "Set {n} of {m} · in progress")
                    .replace("{n}", String(item.setsDone + 1))
                    .replace("{m}", String(item.setsCount))
                : t("tracker_timeline_meta_pending", "{n} sets · pending").replace(
                    "{n}",
                    String(item.setsCount),
                  );
          const tag =
            item.state === "done"
              ? t("tracker_timeline_done", "Done")
              : item.state === "active"
                ? t("tracker_timeline_now", "Now")
                : t("tracker_timeline_next", "Pending");
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
