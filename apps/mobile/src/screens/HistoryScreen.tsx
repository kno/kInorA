/**
 * HistoryScreen — completed workout session history (#09b Session History).
 *
 * Sync-independent (spec: "History available without pending sync
 * activity") — fetches via `getWorkoutHistory` (a plain read against the
 * existing session-token-authenticated API) and NEVER reads or writes the
 * offline mutation queue or session snapshot cache.
 *
 * Copy comes from the shared `@kinora/i18n` catalog via `useIntl()`,
 * mirroring `HomeScreen`/`WorkoutTrackerScreen`.
 */
import React, { useEffect, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useIntl } from "react-intl";
import type { WorkoutHistoryEntry } from "@kinora/contracts";
import { getWorkoutHistory } from "../api/workout-session";
import { styles } from "./HistoryScreen.styles";

const PAGE_SIZE = 20;

function sessionDurationMinutes(entry: WorkoutHistoryEntry): number | undefined {
  const { startedAt, completedAt } = entry.session;
  if (!completedAt) {
    return undefined;
  }

  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  return durationMs > 0 ? Math.round(durationMs / (60 * 1000)) : 0;
}

export default function HistoryScreen() {
  const intl = useIntl();
  const [entries, setEntries] = useState<WorkoutHistoryEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await getWorkoutHistory({ limit: PAGE_SIZE, offset: 0 });
      if (cancelled) return;
      setEntries(result.kind === "ok" ? result.entries : []);
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{intl.formatMessage({ id: "history.title" })}</Text>

      {loaded && entries.length === 0 && (
        <Text style={styles.empty}>{intl.formatMessage({ id: "history.empty" })}</Text>
      )}

      <FlatList
        data={entries}
        keyExtractor={(entry: WorkoutHistoryEntry) => entry.session.id}
        renderItem={({ item }: { item: WorkoutHistoryEntry }) => {
          const durationMinutes = sessionDurationMinutes(item);

          return (
            <View style={styles.card}>
              <Text style={styles.date}>
                {new Date(item.session.completedAt ?? item.session.startedAt).toLocaleDateString()}
              </Text>
              {durationMinutes !== undefined && (
                <Text style={styles.detail}>
                  {intl.formatMessage({ id: "history.duration" }, { minutes: durationMinutes })}
                </Text>
              )}
              <Text style={styles.detail}>{item.session.exercises.length}</Text>
              <Text style={styles.detail}>
                {intl.formatMessage({ id: "history.totalVolume" }, { volume: item.totalVolume })}
              </Text>
              {item.averageRpe !== undefined && (
                <Text style={styles.detail}>
                  {intl.formatMessage({ id: "history.averageRpe" }, { rpe: item.averageRpe })}
                </Text>
              )}
              {item.trend && (
                <Text style={styles.detail}>
                  {intl.formatMessage(
                    { id: `history.trend.${item.trend.direction}` },
                    { volume: Math.abs(item.trend.volumeDelta) },
                  )}
                </Text>
              )}
            </View>
          );
        }}
      />
    </View>
  );
}
