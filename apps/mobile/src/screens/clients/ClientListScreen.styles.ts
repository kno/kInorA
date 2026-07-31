/**
 * Styles for `ClientListScreen` / `ClientCreatePlanScreen` (15a-v2-trainer-
 * account-access, Slice 5). Dark-only design tokens from `src/theme/tokens.ts`,
 * mirroring `plan/PlanStatusScreen.styles.ts`.
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
    fontSize: 22,
    color: colors.fg,
  },
  subtitle: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.fg,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.danger,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[4],
    gap: spacing[2],
  },
  input: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing[2],
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    padding: spacing[3],
    alignItems: "center",
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.bg,
  },
  btnSecondary: {
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    alignItems: "center",
  },
  btnSecondaryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.accent,
  },
  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[3],
  },
  clientEmail: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.fg,
  },
  clientStatus: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
  selectorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
  },
  selectorOption: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
  },
  selectorOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  selectorOptionText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.fg,
  },
  selectorOptionTextSelected: {
    color: colors.bg,
    fontFamily: fonts.bodySemiBold,
  },
});
