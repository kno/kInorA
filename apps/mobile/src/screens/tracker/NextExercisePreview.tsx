/**
 * NextExercisePreview — the dimmed "A continuación" row previewing the next
 * exercise (thumbnail glyph, eyebrow, name, and a detail line).
 *
 * Presentational: the container supplies the pre-resolved `detail` string
 * (which depends on domain logic); this component reads the eyebrow copy.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useIntl } from "react-intl";

import { colors, fonts, radius, spacing } from "../../theme/tokens";
import { ChevronIcon, PersonIcon } from "./icons";
import { messages as M } from "./messages";

interface NextExercisePreviewProps {
  title: string;
  /** Pre-resolved detail line ("3 sets · 30 kg × 10", or reps-only). */
  detail: string;
}

export function NextExercisePreview({ title, detail }: NextExercisePreviewProps) {
  const intl = useIntl();
  // Used both as the card's a11y label and its visible eyebrow text.
  const nextEyebrow = intl.formatMessage(M.nextEyebrow);

  return (
    <View style={styles.nextPreview} accessibilityLabel={nextEyebrow}>
      <View style={styles.nextThumb}>
        <PersonIcon />
      </View>
      <View style={styles.nextInfo}>
        <Text style={styles.nextEyebrow}>{nextEyebrow}</Text>
        <Text style={styles.nextName} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.nextDetail}>{detail}</Text>
      </View>
      <ChevronIcon />
    </View>
  );
}

const styles = StyleSheet.create({
  nextPreview: {
    marginHorizontal: 16,
    marginTop: spacing[2],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    opacity: 0.6,
  },
  nextThumb: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  nextInfo: { flex: 1 },
  nextEyebrow: {
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
    marginBottom: 3,
  },
  nextName: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.fg, letterSpacing: -0.2 },
  nextDetail: { fontSize: 13, color: colors.muted, fontFamily: fonts.body, marginTop: 2 },
});
