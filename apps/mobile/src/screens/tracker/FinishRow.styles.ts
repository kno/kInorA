import { StyleSheet } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";

export const styles = StyleSheet.create({
  finishRow: { marginHorizontal: 16, marginTop: spacing[2], alignItems: "center" },
  btnFinish: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
  },
  btnFinishPressed: { backgroundColor: colors.dangerTint },
  btnFinishText: { color: colors.danger, fontSize: 13, fontFamily: fonts.bodySemiBold },
  completeError: {
    color: colors.danger,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    marginTop: spacing[2],
    textAlign: "center",
    marginHorizontal: 16,
  },
});
