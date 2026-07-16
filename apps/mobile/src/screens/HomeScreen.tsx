/**
 * Mobile home screen — authenticated landing + entry to the workout tracker.
 *
 * INFRA GAP (documented, not faked): the mobile app has no plan-generation or
 * plan-list surface yet, so there is no in-app way to *browse* a ready plan.
 * To reach the live tracker we therefore take a `workoutPlanId` (+ day) as
 * input and start/resume a real session against it via the API. The planId
 * can be prefilled from `EXPO_PUBLIC_DEMO_PLAN_ID` for local testing, or a
 * plan id obtained from the web app / API. Once a mobile plan-list screen
 * exists, this input is replaced by a real selection.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
} from "react-native";
import { useIntl } from "react-intl";
import { deleteSessionToken } from "../auth/session-storage";
import { colors } from "../theme/tokens";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { styles } from "./HomeScreen.styles";

type HomeScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

export default function HomeScreen({ navigation }: HomeScreenProps) {
  // First screen to consume `@kinora/i18n` directly via `useIntl()` (proof
  // screen for change 100 slice 9, tasks 9.4.1/9.4.2) — no `messages` prop
  // drilled in from a parent; `LocaleProvider` (mounted in App.tsx) supplies
  // it via context.
  const intl = useIntl();
  const logoutLabel = intl.formatMessage({ id: "dashboard.logout" });

  const [planId, setPlanId] = useState(
    process.env.EXPO_PUBLIC_DEMO_PLAN_ID ?? "",
  );
  const [day, setDay] = useState("1");

  const handleLogout = async () => {
    await deleteSessionToken();
    navigation.replace("Login");
  };

  const handleStartWorkout = () => {
    const trimmed = planId.trim();
    if (!trimmed) {
      Alert.alert("Falta el plan", "Ingresá un workoutPlanId para empezar.");
      return;
    }
    const parsedDay = Number.parseInt(day, 10);
    navigation.navigate("Tracker", {
      planId: trimmed,
      day: Number.isNaN(parsedDay) ? 1 : parsedDay,
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to kInorA</Text>
      <Text style={styles.subtitle}>Personalized training powered by AI</Text>

      <View style={styles.form}>
        <Text style={styles.fieldLabel}>workoutPlanId</Text>
        <TextInput
          style={styles.input}
          value={planId}
          onChangeText={setPlanId}
          placeholder="plan_..."
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.fieldLabel}>Día</Text>
        <TextInput
          style={styles.input}
          value={day}
          onChangeText={setDay}
          placeholder="1"
          placeholderTextColor={colors.muted}
          keyboardType="number-pad"
        />
        <Pressable
          style={({ pressed }) => [styles.startButton, pressed && styles.startButtonPressed]}
          onPress={handleStartWorkout}
          accessibilityRole="button"
          accessibilityLabel="Empezar entrenamiento"
        >
          <Text style={styles.startButtonText}>Start workout</Text>
        </Pressable>
      </View>

      <Pressable
        style={styles.logoutButton}
        onPress={handleLogout}
        accessibilityRole="button"
        accessibilityLabel={logoutLabel}
      >
        <Text style={styles.logoutText}>{logoutLabel}</Text>
      </Pressable>
    </View>
  );
}
