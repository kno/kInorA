/**
 * RestCard — the rest-timer card: heading + top skip shortcut, the countdown
 * RestRing, and the add-time / skip actions.
 *
 * Presentational: the container owns the rest countdown and the wall-clock
 * bookkeeping; this component composes `RestRing`, formats the countdown, and
 * reads its own copy from the shared catalog.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";

import { colors, fonts, radius, spacing } from "../../theme/tokens";
import { formatCountdown } from "./tracker-logic";
import { RestRing } from "./RestRing";
import { messages as M } from "./messages";

interface RestCardProps {
  restRemaining: number;
  restDuration: number;
  /** Ring/time color — amber normally, lime in the final seconds. */
  restColor: string;
  onAddTime: () => void;
  onSkip: () => void;
}

export function RestCard({
  restRemaining,
  restDuration,
  restColor,
  onAddTime,
  onSkip,
}: RestCardProps) {
  const intl = useIntl();
  // Same skip label backs 3 spots in this card (top-right shortcut + the
  // bottom button's a11y label and its visible text) — one call.
  const skipRestLabel = intl.formatMessage(M.skipRest);

  return (
    <View
      style={styles.restCard}
      accessibilityLabel={intl.formatMessage(M.restA11y)}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.restHeaderRow}>
        <View style={styles.restHeading}>
          <View style={styles.restHeadingDot} />
          <Text style={styles.restHeadingText}>
            <FormattedMessage {...M.restActive} />
          </Text>
        </View>
        <Pressable
          style={styles.restSkipBtnTop}
          onPress={onSkip}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={skipRestLabel}
        >
          <Text style={styles.restSkipBtnTopText}>
            <FormattedMessage {...M.skip} />
          </Text>
        </Pressable>
      </View>

      <View style={styles.ringWrap}>
        <RestRing remaining={restRemaining} duration={restDuration} strokeColor={restColor} />
        <View style={styles.ringCenter} pointerEvents="none">
          <Text style={[styles.ringTime, { color: restColor }]}>
            {formatCountdown(restRemaining)}
          </Text>
          <Text style={styles.ringLabelSm}>
            <FormattedMessage {...M.restLabelSm} />
          </Text>
        </View>
      </View>

      <View style={styles.restActions}>
        <Pressable
          style={({ pressed }) => [styles.btnAddTime, pressed && styles.btnAddTimePressed]}
          onPress={onAddTime}
          accessibilityRole="button"
          accessibilityLabel={intl.formatMessage(M.addTimeA11y)}
        >
          <Text style={styles.btnAddTimeText}>
            <FormattedMessage {...M.addTime} />
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.btnSkip, pressed && styles.btnSkipPressed]}
          onPress={onSkip}
          accessibilityRole="button"
          accessibilityLabel={skipRestLabel}
        >
          <Text style={styles.btnSkipText}>{skipRestLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  restCard: {
    marginHorizontal: 16,
    marginTop: spacing[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardLg,
    padding: 20,
    alignItems: "center",
    gap: spacing[3],
  },
  restHeaderRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  restHeading: { flexDirection: "row", alignItems: "center", gap: 6 },
  restHeadingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.warning },
  restHeadingText: { fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.fg },
  restSkipBtnTop: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  restSkipBtnTopText: { fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.muted },
  ringWrap: { width: 130, height: 130, alignItems: "center", justifyContent: "center" },
  ringCenter: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  ringTime: {
    fontFamily: fonts.displayBold,
    fontSize: 32,
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  ringLabelSm: {
    fontSize: 11,
    color: colors.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontFamily: fonts.bodySemiBold,
  },
  restActions: { flexDirection: "row", gap: 10, width: "100%" },
  btnAddTime: {
    flex: 1,
    height: 44,
    backgroundColor: colors.warningTint,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: radius.btn,
    alignItems: "center",
    justifyContent: "center",
  },
  btnAddTimePressed: { backgroundColor: colors.warningTintHover },
  btnAddTimeText: { color: colors.warning, fontSize: 14, fontFamily: fonts.bodySemiBold },
  btnSkip: {
    flex: 1,
    height: 44,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.btn,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSkipPressed: { backgroundColor: colors.border },
  btnSkipText: { color: colors.fg, fontSize: 14, fontFamily: fonts.bodySemiBold },
});
