/**
 * FinishRow — the "Finalizar sesión" button plus an inline complete error.
 *
 * Presentational: the container owns the submit state and the completion
 * handler; this component reads its own copy from the shared catalog.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";

import { StopIcon } from "./icons";
import { messages as M } from "./messages";
import { styles } from "./FinishRow.styles";

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
