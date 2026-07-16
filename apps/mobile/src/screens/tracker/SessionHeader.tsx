/**
 * SessionHeader — session eyebrow + current-exercise title on the left, the
 * elapsed timer and pause/resume toggle on the right.
 *
 * Presentational: the container owns the elapsed count and pause state; this
 * component formats the timer and reads its own copy from the shared catalog.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useIntl } from "react-intl";

import { colors, fonts, radius, spacing } from "../../theme/tokens";
import { formatElapsed } from "./tracker-logic";
import { PauseIcon, PlayIcon } from "./icons";
import { messages as M } from "./messages";

interface SessionHeaderProps {
  title: string;
  /** Elapsed session time, in whole seconds. */
  elapsed: number;
  paused: boolean;
  onTogglePause: () => void;
}

export function SessionHeader({ title, elapsed, paused, onTogglePause }: SessionHeaderProps) {
  const intl = useIntl();
  // Referenced twice below (accessibility label + visible text) — formatted
  // once so the elapsed timer's 1s re-render does not repeat the lookup.
  const elapsedLabel = intl.formatMessage(M.elapsedLabel);

  return (
    <View style={styles.sessionHeader}>
      <View style={styles.sessionMeta}>
        <Text style={styles.sessionSubtitle}>{intl.formatMessage(M.sessionActiveEyebrow)}</Text>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <View style={styles.sessionRight}>
        <View
          style={styles.elapsedTimer}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${elapsedLabel} ${formatElapsed(elapsed)}`}
        >
          <Text style={styles.elapsedLabel}>{elapsedLabel}</Text>
          <Text style={styles.elapsedValue}>{formatElapsed(elapsed)}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.pauseBtn, pressed && styles.pauseBtnPressed]}
          onPress={onTogglePause}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={
            paused ? intl.formatMessage(M.resumeLabel) : intl.formatMessage(M.pauseLabel)
          }
        >
          {paused ? <PlayIcon /> : <PauseIcon />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sessionHeader: {
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
  },
  sessionMeta: { flexDirection: "column", gap: 2, flexShrink: 1 },
  sessionSubtitle: { fontSize: 12, color: colors.muted, fontFamily: fonts.bodyMedium },
  sessionTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    color: colors.fg,
    letterSpacing: -0.4,
  },
  sessionRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  elapsedTimer: { flexDirection: "column", alignItems: "flex-end" },
  elapsedLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
  },
  elapsedValue: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: colors.fg,
    letterSpacing: -0.4,
    fontVariant: ["tabular-nums"],
  },
  pauseBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pauseBtnPressed: { backgroundColor: colors.surface2 },
});
