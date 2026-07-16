/**
 * SessionHeader — session eyebrow + current-exercise title on the left, the
 * elapsed timer and pause/resume toggle on the right.
 *
 * Presentational: the container owns the elapsed count and pause state; this
 * component formats the timer and reads its own copy from the shared catalog.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";
import { useIntl } from "react-intl";

import { formatElapsed } from "./tracker-logic";
import { PauseIcon, PlayIcon } from "./icons";
import { messages as M } from "./messages";
import { styles } from "./SessionHeader.styles";

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
