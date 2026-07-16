import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";

export const styles = StyleSheet.create({
  progressArea: { paddingHorizontal: 20, paddingTop: spacing[3] },
  progressInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[1],
  },
  progressInfoLabel: { fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.fg },
  progressInfoCount: {
    fontSize: 13,
    color: colors.muted,
    fontFamily: fonts.display,
    fontVariant: ["tabular-nums"],
  },
  segBar: { flexDirection: "row", gap: 4, height: 5 },
  seg: { flex: 1, borderRadius: radius.pill, backgroundColor: colors.surface2 },
  segDone: { backgroundColor: colors.accent },
  segActive: { backgroundColor: colors.accentActive },
});
