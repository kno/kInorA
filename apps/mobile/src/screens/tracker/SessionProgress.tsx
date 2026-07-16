/**
 * SessionProgress — the "Exercise n of m" info row plus a segmented bar with
 * one segment per exercise (done / active / pending).
 *
 * Presentational: the container derives the numbers and segment states; this
 * component reads its own copy and exposes the progressbar semantics.
 */

import React from "react";
import { Text, View } from "react-native";
import { useIntl } from "react-intl";

import type { SegmentState } from "./tracker-logic";
import { messages as M } from "./messages";
import { styles } from "./SessionProgress.styles";

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
