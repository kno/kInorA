import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";

export const styles = StyleSheet.create({
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
