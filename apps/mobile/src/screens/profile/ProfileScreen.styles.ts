/**
 * Styles for `ProfileScreen` (17c-profile-body-metrics, PR 5). Dark-only
 * design tokens from `src/theme/tokens.ts`, mirroring
 * `ClientListScreen.styles.ts`'s selector-row pattern (used here for the
 * goal / experience-level / self-described-sex pickers).
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
    backgroundColor: colors.bg,
  },
  card: {
    padding: spacing[3],
    borderRadius: radius.card,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing[2],
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    color: colors.fg,
  },
  subtitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.muted,
    marginTop: spacing[2],
  },
  input: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    backgroundColor: colors.surface2,
  },
  selectorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[1],
  },
  selectorOption: {
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  selectorOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  selectorOptionText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.muted,
  },
  selectorOptionTextSelected: {
    color: colors.accent,
  },
  btn: {
    marginTop: spacing[2],
    paddingVertical: spacing[2],
    borderRadius: radius.btn,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accent,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.accentFg,
  },
  statusText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.accent,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.danger,
  },
  notice: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing[2],
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.fg,
  },
  entryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  entryText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.fg,
  },
});
