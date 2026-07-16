import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";

export const styles = StyleSheet.create({
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
