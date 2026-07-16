/**
 * ExerciseCard — the current-exercise workbench: eyebrow, name, set-info line,
 * the Carga (load) and Reps steppers, the "Completar serie" CTA and an inline
 * record error.
 *
 * Presentational: the container owns the live stepper values and supplies the
 * step handlers plus the resolved `objective` string (which depends on domain
 * logic). This component reads the rest of its copy from the shared catalog.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";

import { colors, fonts, radius, spacing } from "../../theme/tokens";
import { formatWeight } from "./tracker-logic";
import { CheckIcon } from "./icons";
import { Stepper } from "./Stepper";
import { messages as M } from "./messages";

interface ExerciseCardProps {
  title: string;
  currentSetNumber: number;
  setsInCurrentExercise: number;
  /** Pre-resolved objective line ("40 kg × 8", or reps-only) from the container. */
  objective: string;
  weight: number;
  reps: number;
  onStepWeight: (direction: 1 | -1) => void;
  onStepReps: (direction: 1 | -1) => void;
  onCompleteSet: () => void;
  isResting: boolean;
  submitting: boolean;
  showRecordError: boolean;
}

export function ExerciseCard({
  title,
  currentSetNumber,
  setsInCurrentExercise,
  objective,
  weight,
  reps,
  onStepWeight,
  onStepReps,
  onCompleteSet,
  isResting,
  submitting,
  showRecordError,
}: ExerciseCardProps) {
  const intl = useIntl();

  return (
    <View style={styles.exerciseCard}>
      <View style={styles.cardTopAccent} />
      <Text style={styles.excardEyebrow}>
        <FormattedMessage {...M.currentExerciseEyebrow} />
      </Text>
      <Text style={styles.excardName}>{title}</Text>
      <Text style={styles.excardSetInfo}>
        <FormattedMessage
          {...M.setInfo}
          values={{
            setNumber: currentSetNumber,
            setTotal: setsInCurrentExercise,
            targetLabel: objective,
          }}
        />
      </Text>

      <View style={styles.steppersRow}>
        <Stepper
          label={intl.formatMessage(M.loadLabel)}
          value={formatWeight(weight)}
          unit={intl.formatMessage(M.loadUnit)}
          onDecrement={() => onStepWeight(-1)}
          onIncrement={() => onStepWeight(1)}
          decrementLabel={intl.formatMessage(M.decreaseLoad)}
          incrementLabel={intl.formatMessage(M.increaseLoad)}
          disabled={isResting}
        />
        <Stepper
          label={intl.formatMessage(M.repsLabel)}
          value={String(reps)}
          unit={intl.formatMessage(M.repsUnit)}
          onDecrement={() => onStepReps(-1)}
          onIncrement={() => onStepReps(1)}
          decrementLabel={intl.formatMessage(M.decreaseReps)}
          incrementLabel={intl.formatMessage(M.increaseReps)}
          disabled={isResting}
        />
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.btnComplete,
          (isResting || submitting) && styles.btnCompleteDisabled,
          pressed && styles.btnCompletePressed,
        ]}
        onPress={onCompleteSet}
        disabled={isResting || submitting}
        accessibilityRole="button"
        accessibilityLabel={intl.formatMessage(M.completeSetA11y, {
          setNumber: currentSetNumber,
        })}
        accessibilityState={{ disabled: isResting || submitting }}
      >
        <CheckIcon />
        <Text style={styles.btnCompleteText}>
          <FormattedMessage {...M.completeSet} />
        </Text>
      </Pressable>

      {showRecordError && (
        <Text style={styles.recordError} accessibilityRole="alert">
          <FormattedMessage {...M.errorRecord} />
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  exerciseCard: {
    marginHorizontal: 16,
    marginTop: spacing[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.cardLg,
    padding: 20,
    overflow: "hidden",
  },
  cardTopAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.accent,
  },
  excardEyebrow: {
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
    marginBottom: 6,
  },
  excardName: {
    fontFamily: fonts.displayBold,
    fontSize: 26,
    color: colors.fg,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  excardSetInfo: { fontSize: 13, color: colors.muted, fontFamily: fonts.body, marginBottom: 20 },
  steppersRow: { flexDirection: "row", gap: spacing[2], marginBottom: 20 },
  btnComplete: {
    width: "100%",
    height: 54,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
  },
  btnCompletePressed: { opacity: 0.92 },
  btnCompleteDisabled: { opacity: 0.4 },
  btnCompleteText: { color: colors.accentFg, fontSize: 16, fontFamily: fonts.bodyBold },
  recordError: {
    color: colors.danger,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    marginTop: spacing[2],
  },
});
