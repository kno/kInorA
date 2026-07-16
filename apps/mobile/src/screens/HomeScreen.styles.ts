import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../theme/tokens";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing[4],
    backgroundColor: colors.bg,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.fg,
    marginBottom: spacing[1],
    textAlign: "center",
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
    marginBottom: spacing[5],
    textAlign: "center",
  },
  form: { gap: spacing[1], marginBottom: spacing[4] },
  fieldLabel: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.fg,
    borderRadius: radius.btn,
    padding: spacing[2],
    fontSize: 16,
    fontFamily: fonts.body,
    marginBottom: spacing[2],
  },
  startButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  startButtonPressed: { opacity: 0.92 },
  startButtonText: { color: colors.accentFg, fontSize: 16, fontFamily: fonts.bodyBold },
  historyButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
    marginTop: spacing[2],
  },
  historyButtonPressed: { opacity: 0.92 },
  historyText: { color: colors.fg, fontSize: 15, fontFamily: fonts.bodySemiBold },
  logoutButton: { padding: spacing[2], alignItems: "center", minHeight: 44, justifyContent: "center" },
  logoutText: { color: colors.muted, fontSize: 15, fontFamily: fonts.bodySemiBold },
});
