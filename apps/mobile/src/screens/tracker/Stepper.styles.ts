import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";

export const styles = StyleSheet.create({
  stepperGroup: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing[2],
    gap: 6,
  },
  stepperLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
    textAlign: "center",
  },
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnPressed: { backgroundColor: colors.border },
  stepValueWrap: { flex: 1, alignItems: "center" },
  stepValue: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.fg,
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  stepUnit: { fontSize: 13, color: colors.muted, fontFamily: fonts.body },
});
