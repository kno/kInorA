/**
 * Shared styling for the mobile auth screens — LoginScreen and SignUpScreen
 * (kno/kInorA#445), built to the Open Design screen `mobile-auth.html`.
 *
 * It replaces `LoginScreen.styles.ts` and `SignUpScreen.styles.ts`, which were
 * byte-identical copies of a white-canvas, `#0070f3`-blue sheet that predates
 * the design system entirely: they were the only surfaces in the app still
 * hardcoding colours instead of consuming `theme/tokens.ts`. The screen draws
 * login and sign-up as one system differing only in copy, so one sheet serves
 * both rather than two copies drifting apart again.
 *
 * Every colour, radius and spacing value comes from `theme/tokens.ts`. Type
 * sizes are the screen's own (`mobile-auth.html`: 24px title, 13.5px sub,
 * 11.5px label, 14.5px input/button), which the token set does not enumerate.
 */

import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  /*
   * The screen scrolls (`.auth-scroll`) rather than centring: with the
   * keyboard up, a vertically centred form pushes its own submit button off
   * the viewport on a short device.
   */
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[6],
    paddingBottom: spacing[5],
  },

  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: spacing[4],
  },
  brandName: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    letterSpacing: -0.2,
    color: colors.fg,
  },

  title: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    letterSpacing: -0.5,
    color: colors.fg,
    marginBottom: 6,
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.muted,
    marginBottom: spacing[4],
  },

  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: radius.btn,
    backgroundColor: colors.dangerTint,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    marginBottom: spacing[3],
  },
  bannerText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.danger,
  },

  field: {
    marginBottom: 14,
  },
  label: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 11.5,
    color: colors.muted,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.btn,
    color: colors.fg,
    fontFamily: fonts.body,
    fontSize: 14.5,
    paddingHorizontal: 13,
    paddingVertical: 12,
    minHeight: 46,
  },
  inputInvalid: {
    borderColor: colors.danger,
  },
  hint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    marginTop: 6,
  },
  hintText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.danger,
  },

  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.accent,
    borderRadius: radius.btn,
    paddingVertical: 13,
    minHeight: 48,
    marginTop: 4,
  },
  primaryButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14.5,
    color: colors.accentFg,
  },
  buttonDisabled: {
    opacity: 0.55,
  },

  separator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 18,
  },
  separatorRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  separatorLabel: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.muted,
  },

  googleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.btn,
    paddingVertical: 13,
    minHeight: 48,
  },
  googleButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14.5,
    color: colors.fg,
  },

  foot: {
    marginTop: 22,
    alignItems: "center",
  },
  footText: {
    fontFamily: fonts.body,
    fontSize: 12.5,
    color: colors.muted,
    textAlign: "center",
  },
  footLink: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12.5,
    color: colors.accent,
  },
});
