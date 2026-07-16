/**
 * Stepper — a label + value/unit readout flanked by −/+ buttons.
 *
 * Presentational: the parent owns the value and supplies the increment /
 * decrement handlers and their accessibility labels. Used for the Carga (load)
 * and Reps controls in `ExerciseCard`.
 */

import React from "react";
import { Pressable, Text, View } from "react-native";

import { MinusIcon, PlusIcon } from "./icons";
import { styles } from "./Stepper.styles";

export function Stepper(props: {
  label: string;
  value: string;
  unit: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel: string;
  incrementLabel: string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.stepperGroup}>
      <Text style={styles.stepperLabel}>{props.label}</Text>
      <View style={styles.stepperControls}>
        <Pressable
          style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
          onPress={props.onDecrement}
          disabled={props.disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={props.decrementLabel}
          accessibilityState={{ disabled: !!props.disabled }}
        >
          <MinusIcon />
        </Pressable>
        <View style={styles.stepValueWrap}>
          <Text style={styles.stepValue}>{props.value}</Text>
          <Text style={styles.stepUnit}>{props.unit}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.stepBtn, pressed && styles.stepBtnPressed]}
          onPress={props.onIncrement}
          disabled={props.disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={props.incrementLabel}
          accessibilityState={{ disabled: !!props.disabled }}
        >
          <PlusIcon />
        </Pressable>
      </View>
    </View>
  );
}
