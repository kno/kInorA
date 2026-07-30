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
import { Pressable, Text, TextInput, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";

import { formatWeight, WEIGHT_STEPS } from "./tracker-logic";
import { CheckIcon } from "./icons";
import { Stepper } from "./Stepper";
import { messages as M } from "./messages";
import { styles } from "./ExerciseCard.styles";

interface ExerciseCardProps {
  title: string;
  currentSetNumber: number;
  setsInCurrentExercise: number;
  /** Pre-resolved objective line ("40 kg × 8", or reps-only) from the container. */
  objective: string;
  weight: number;
  reps: number;
  /** Currently selected +/- load increment (one of `WEIGHT_STEPS`). */
  weightStep: number;
  onSelectWeightStep: (step: number) => void;
  onStepWeight: (direction: 1 | -1) => void;
  onStepReps: (direction: 1 | -1) => void;
  onCompleteSet: () => void;
  isResting: boolean;
  submitting: boolean;
  showRecordError: boolean;
  /** Optional 0-10 RPE draft value (raw text; parsed/clamped by the container). */
  rpeInput: string;
  onChangeRpe: (text: string) => void;
}

export function ExerciseCard({
  title,
  currentSetNumber,
  setsInCurrentExercise,
  objective,
  weight,
  reps,
  weightStep,
  onSelectWeightStep,
  onStepWeight,
  onStepReps,
  onCompleteSet,
  isResting,
  submitting,
  showRecordError,
  rpeInput,
  onChangeRpe,
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

      <View
        style={styles.stepSizeRow}
        accessibilityLabel={intl.formatMessage(M.loadStepGroupLabel)}
      >
        <Text style={styles.stepSizeLabel}>
          <FormattedMessage {...M.loadStepLabel} />
        </Text>
        <View style={styles.stepSizeOptions}>
          {WEIGHT_STEPS.map((step) => {
            const selected = weightStep === step;
            return (
              <Pressable
                key={step}
                style={[styles.stepSizeOption, selected && styles.stepSizeOptionActive]}
                onPress={() => onSelectWeightStep(step)}
                disabled={isResting}
                accessibilityRole="button"
                accessibilityLabel={intl.formatMessage(M.loadStepOptionA11y, { step })}
                accessibilityState={{ selected, disabled: isResting }}
              >
                <Text
                  style={[
                    styles.stepSizeOptionText,
                    selected && styles.stepSizeOptionTextActive,
                  ]}
                >
                  {formatWeight(step)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.rpeField}>
        <Text style={styles.rpeLabel}>
          <FormattedMessage {...M.rpeLabel} />
        </Text>
        <TextInput
          style={styles.rpeInput}
          value={rpeInput}
          onChangeText={onChangeRpe}
          keyboardType="numeric"
          accessibilityLabel={intl.formatMessage(M.rpeInputA11y)}
          editable={!isResting}
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
