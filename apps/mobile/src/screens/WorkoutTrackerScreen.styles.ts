import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../theme/tokens";

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    gap: spacing[3],
  },
  stateText: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
  },
  conflictText: { color: colors.fg },
  errorText: { color: colors.danger },
  completeTitle: {
    color: colors.fg,
    fontFamily: fonts.displayBold,
    fontSize: 26,
    letterSpacing: -0.5,
    textAlign: "center",
  },

  /* Shared secondary button (state screens) */
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
    borderRadius: radius.btn,
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 44,
    justifyContent: "center",
  },
  secondaryBtnText: { color: colors.fg, fontSize: 15, fontFamily: fonts.bodySemiBold },
});
