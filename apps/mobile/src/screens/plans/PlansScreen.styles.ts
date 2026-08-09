/**
 * Styles for `PlansScreen` (17d PR C). Dark-only design tokens from
 * `src/theme/tokens.ts`, mirroring `clients/ClientListScreen.styles.ts`.
 *
 * The two visual ideas carried over from the web `/plans` surface (and the
 * Open Design mock behind it), expressed in a native idiom rather than
 * transliterated from CSS:
 *   - the currently-followed plan is not just another row — it carries an
 *     accent border and a badge;
 *   - "last trained" is colour-coded by age (recent / aging / stale), so a
 *     plan nobody has touched in months reads differently at a glance.
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
  description: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.muted,
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
  currentCard: {
    borderWidth: 1,
    borderColor: colors.accent,
  },
  badge: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.accent,
    textTransform: "uppercase",
  },
  archivedBadge: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 12,
    color: colors.muted,
    textTransform: "uppercase",
  },
  planName: {
    fontFamily: fonts.displayBold,
    fontSize: 18,
    color: colors.fg,
  },
  detail: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
  },
  // "Last trained" age bands — the same three-band scale the web list uses.
  lastTrainedRecent: {
    color: colors.accent,
  },
  lastTrainedAging: {
    color: colors.fg,
  },
  lastTrainedStale: {
    color: colors.danger,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    marginTop: spacing[2],
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    alignItems: "center",
  },
  btnText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.bg,
  },
  btnSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3],
    alignItems: "center",
  },
  btnSecondaryText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.fg,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  separator: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing[3],
    paddingTop: spacing[3],
    gap: spacing[2],
  },
  sectionHeading: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 16,
    color: colors.fg,
  },
});
