import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../theme/tokens";

export const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing[4],
    gap: spacing[2],
    marginBottom: spacing[4],
    backgroundColor: colors.surface,
  },
  eyebrow: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 13,
    color: colors.accent,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    color: colors.fg,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.fg,
  },
  actions: {
    flexDirection: "row",
    gap: spacing[2],
    marginTop: spacing[1],
  },
  acceptButton: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  acceptButtonPressed: { opacity: 0.92 },
  acceptButtonDisabled: { opacity: 0.5 },
  acceptText: { color: colors.accentFg, fontSize: 15, fontFamily: fonts.bodyBold },
  dismissButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing[4],
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  dismissButtonPressed: { opacity: 0.92 },
  dismissText: { color: colors.fg, fontSize: 15, fontFamily: fonts.bodySemiBold },
  pending: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
});
