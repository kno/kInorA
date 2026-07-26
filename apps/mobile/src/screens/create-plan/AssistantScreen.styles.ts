import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";

/**
 * Styles for the RN create-plan Asistente screen (item-13 C2b). Dark-only
 * theme from the shared design tokens (see `theme/tokens.ts`); mirrors the web
 * `assistant-pane.module.css` layout adapted to a single-column mobile stack:
 * the chat thread scrolls above a pinned input row, with the "Datos extraídos"
 * panel below the thread.
 */
export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[3],
    gap: spacing[2],
  },
  coachName: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    color: colors.fg,
  },
  coachStatus: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.muted,
    marginBottom: spacing[2],
  },
  // --- chat bubbles ---
  bubbleRowUser: {
    alignItems: "flex-end",
  },
  bubbleRowAi: {
    alignItems: "flex-start",
  },
  bubbleUser: {
    backgroundColor: colors.accentDim,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    maxWidth: "85%",
  },
  bubbleAi: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    maxWidth: "85%",
  },
  bubbleText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.fg,
  },
  streamingHint: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    fontStyle: "italic",
  },
  // --- error ---
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerTint,
    borderRadius: radius.md,
    padding: spacing[2],
    gap: spacing[1],
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.fg,
  },
  // --- input row ---
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    padding: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.fg,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.btn,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    minHeight: 44,
  },
  // --- generic buttons ---
  btn: {
    borderRadius: radius.btn,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  btnPrimaryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.accentFg,
  },
  btnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.fg,
  },
  btnDisabled: {
    opacity: 0.4,
  },
  // --- extracted-data panel ---
  panel: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing[3],
    gap: spacing[2],
    marginTop: spacing[2],
  },
  panelTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    color: colors.fg,
  },
  field: {
    gap: spacing[1],
  },
  fieldLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.muted,
  },
  fieldValue: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.fg,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[1],
  },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing[2],
    backgroundColor: colors.bg,
  },
  pillSelected: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  pillText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.fg,
  },
  numberInput: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.fg,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.btn,
    paddingVertical: spacing[1],
    paddingHorizontal: spacing[2],
    minHeight: 44,
  },
});
