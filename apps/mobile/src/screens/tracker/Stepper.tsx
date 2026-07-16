/**
 * Stepper — a label + value/unit readout flanked by −/+ buttons.
 *
 * Presentational: the parent owns the value and supplies the increment /
 * decrement handlers and their accessibility labels. Used for the Carga (load)
 * and Reps controls in `ExerciseCard`.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, fonts, radius, spacing } from "../../theme/tokens";
import { MinusIcon, PlusIcon } from "./icons";

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

const styles = StyleSheet.create({
  stepperGroup: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing[2],
    gap: 6,
  },
  stepperLabel: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: colors.muted,
    fontFamily: fonts.bodySemiBold,
    textAlign: "center",
  },
  stepperControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnPressed: { backgroundColor: colors.border },
  stepValueWrap: { flex: 1, alignItems: "center" },
  stepValue: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    color: colors.fg,
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  stepUnit: { fontSize: 13, color: colors.muted, fontFamily: fonts.body },
});
