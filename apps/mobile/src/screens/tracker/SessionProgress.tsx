/**
 * SessionProgress — the "Exercise n of m" info row plus a segmented bar with
 * one segment per exercise (done / active / pending).
 *
 * Presentational: the container derives the numbers and segment states; this
 * component reads its own copy and exposes the progressbar semantics.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useIntl } from "react-intl";

import { colors, fonts, radius, spacing } from "../../theme/tokens";
import type { SegmentState } from "./tracker-logic";
import { messages as M } from "./messages";

interface SessionProgressProps {
  currentExerciseNumber: number;
  exerciseCount: number;
  percent: number;
  segments: SegmentState[];
}

export function SessionProgress({
  currentExerciseNumber,
  exerciseCount,
  percent,
  segments,
}: SessionProgressProps) {
  const intl = useIntl();

  return (
    <View style={styles.progressArea}>
      <View style={styles.progressInfo}>
        <Text style={styles.progressInfoLabel}>
          {intl.formatMessage(M.progressLabel, {
            n: currentExerciseNumber,
            m: exerciseCount,
          })}
        </Text>
        <Text style={styles.progressInfoCount}>{percent}%</Text>
      </View>
      <View
        style={styles.segBar}
        accessibilityRole="progressbar"
        accessibilityValue={{
          text: intl.formatMessage(M.progressValueText, {
            n: currentExerciseNumber,
            m: exerciseCount,
            percent,
          }),
        }}
        accessibilityLabel={intl.formatMessage(M.progressA11y, {
          current: currentExerciseNumber,
          total: exerciseCount,
        })}
      >
        {segments.map((state, i) => (
          <View
            key={i}
            style={[
              styles.seg,
              state === "done" && styles.segDone,
              state === "active" && styles.segActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  progressArea: { paddingHorizontal: 20, paddingTop: spacing[3] },
  progressInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[1],
  },
  progressInfoLabel: { fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.fg },
  progressInfoCount: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.display,
    fontVariant: ["tabular-nums"],
  },
  segBar: { flexDirection: "row", gap: 4, height: 5 },
  seg: { flex: 1, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  segDone: { backgroundColor: colors.accent },
  segActive: { backgroundColor: colors.accentActive },
});
