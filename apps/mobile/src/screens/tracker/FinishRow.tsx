/**
 * FinishRow — the "Finalizar sesión" button plus an inline complete error.
 *
 * Presentational: the container owns the submit state and the completion
 * handler; this component reads its own copy from the shared catalog.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";

import { colors, fonts, radius, spacing } from "../../theme/tokens";
import { StopIcon } from "./icons";
import { messages as M } from "./messages";

interface FinishRowProps {
  onFinish: () => void;
  submitting: boolean;
  showCompleteError: boolean;
}

export function FinishRow({ onFinish, submitting, showCompleteError }: FinishRowProps) {
  const intl = useIntl();

  return (
    <>
      <View style={styles.finishRow}>
        <Pressable
          style={({ pressed }) => [styles.btnFinish, pressed && styles.btnFinishPressed]}
          onPress={onFinish}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={intl.formatMessage(M.finishSessionA11y)}
          accessibilityState={{ disabled: submitting }}
        >
          <StopIcon />
          <Text style={styles.btnFinishText}>
            <FormattedMessage {...M.finishSession} />
          </Text>
        </Pressable>
      </View>

      {showCompleteError && (
        <Text style={styles.completeError} accessibilityRole="alert">
          <FormattedMessage {...M.errorComplete} />
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
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
