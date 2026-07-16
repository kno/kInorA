import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../theme/tokens";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    backgroundColor: colors.bg,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 24,
    color: colors.fg,
    marginBottom: spacing[3],
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing[3],
    marginBottom: spacing[2],
  },
  date: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.fg,
    marginBottom: spacing[1],
  },
  detail: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
  },
});
