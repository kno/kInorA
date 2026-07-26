/**
 * Styles for `PlanStatusScreen` (14a Track C2). Dark-only design tokens from
 * `src/theme/tokens.ts`, mirroring the tracker/assistant screen styling.
 */

import { StyleSheet } from "react-native";
import { colors, fonts, radius, spacing } from "../../theme/tokens";

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: spacing[4],
    gap: spacing[3],
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing[4],
    gap: spacing[3],
    backgroundColor: colors.bg,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    color: colors.fg,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
    textAlign: "center",
  },
  sessionCount: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.accent,
  },
  sessionRow: {
    padding: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sessionTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.fg,
  },
  notice: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.warning,
    textAlign: "center",
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.danger,
    textAlign: "center",
  },
  btn: {
    marginTop: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.btn,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPrimary: {
    backgroundColor: colors.accent,
  },
  btnPrimaryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.accentFg,
  },
  btnSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnSecondaryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.fg,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
