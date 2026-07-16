import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";

export const styles = StyleSheet.create({
  exerciseCard: {
    marginHorizontal: 16,
    marginTop: spacing[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardLg,
    padding: 20,
    overflow: "hidden",
  },
  cardTopAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.accent,
  },
  excardEyebrow: {
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
    marginBottom: 6,
  },
  excardName: {
    fontFamily: fonts.displayBold,
    fontSize: 26,
    color: colors.fg,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  excardSetInfo: { fontSize: 13, color: colors.muted, fontFamily: fonts.body, marginBottom: 20 },
  steppersRow: { flexDirection: "row", gap: spacing[2], marginBottom: 20 },
  btnComplete: {
    width: "100%",
    height: 54,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
  },
  btnCompletePressed: { opacity: 0.92 },
  btnCompleteDisabled: { opacity: 0.4 },
  btnCompleteText: { color: colors.accentFg, fontSize: 16, fontFamily: fonts.bodyBold },
  recordError: {
    color: colors.danger,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    marginTop: spacing[2],
  },
});
