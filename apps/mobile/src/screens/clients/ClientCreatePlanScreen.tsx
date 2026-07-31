/**
 * ClientCreatePlanScreen — mobile create-plan-for-client surface
 * (15a-v2-trainer-account-access, Slice 5).
 *
 * A dedicated, self-contained minimal form (mirrors the web app's
 * `CreatePlanForClientForm`) rather than reusing `AssistantScreen`'s chat
 * flow — the client-owned route has NO draft phase server-side (`plan.ts`'s
 * `buildConfirmedSpecFromInput` accepts the full flat spec directly), so this
 * captures goal/daysPerWeek/sessionDurationMinutes/location in one step and
 * posts once via `POST /clients/:clientUserId/plan-specs`.
 * Equipment/limitations default to empty arrays (both valid per
 * `assertPlanSpecInput`).
 */

import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { PlanGoal, TrainingLocation } from "@kinora/contracts";

import {
  createPlanForClient as defaultCreatePlanForClient,
  type ClientOptions,
  type CreatePlanForClientResult,
} from "../../api/trainer-client";
import { messages as M } from "./messages";
import { styles } from "./ClientListScreen.styles";

const GOALS: PlanGoal[] = ["strength", "hypertrophy", "fat_loss", "general_fitness"];
const LOCATIONS: TrainingLocation[] = ["home", "gym", "outdoor"];

const GOAL_LABEL_IDS: Record<PlanGoal, string> = {
  strength: "wizard.goal.strength.label",
  hypertrophy: "wizard.goal.hypertrophy.label",
  fat_loss: "wizard.goal.fatLoss.label",
  general_fitness: "wizard.goal.generalFitness.label",
};

const LOCATION_LABEL_IDS: Record<TrainingLocation, string> = {
  home: "wizard.location.home.label",
  gym: "wizard.location.gym.label",
  outdoor: "wizard.location.outdoor.label",
};

export type ClientCreatePlanRouteParams = { clientUserId: string };

export interface ClientCreatePlanScreenProps {
  navigation: NativeStackNavigationProp<any>;
  route: { params: ClientCreatePlanRouteParams };
  createPlanForClient?: (
    clientUserId: string,
    input: Parameters<typeof defaultCreatePlanForClient>[1],
    options?: ClientOptions,
  ) => Promise<CreatePlanForClientResult>;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
}

export default function ClientCreatePlanScreen({
  navigation,
  route,
  createPlanForClient,
  apiBaseUrl,
  getToken,
}: ClientCreatePlanScreenProps) {
  const intl = useIntl();
  const { clientUserId } = route.params;

  const [goal, setGoal] = useState<PlanGoal>("strength");
  const [daysPerWeek, setDaysPerWeek] = useState("3");
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState("45");
  const [location, setLocation] = useState<TrainingLocation>("gym");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createFnRef = useRef(createPlanForClient ?? defaultCreatePlanForClient);
  createFnRef.current = createPlanForClient ?? defaultCreatePlanForClient;

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createFnRef.current(
        clientUserId,
        {
          goal,
          daysPerWeek: Number(daysPerWeek),
          sessionDurationMinutes: Number(sessionDurationMinutes),
          location,
          equipment: [],
          limitations: [],
        },
        { apiBaseUrl, getToken },
      );

      if (result.kind === "ok") {
        navigation.navigate("PlanStatus", { planId: result.planId });
        return;
      }

      setError(
        intl.formatMessage(
          result.message === "forbidden" ? M.createPlanErrorForbidden : M.createPlanErrorGeneric,
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }, [submitting, clientUserId, goal, daysPerWeek, sessionDurationMinutes, location, apiBaseUrl, getToken, navigation, intl]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="client-create-plan">
      <Text style={styles.title}>
        <FormattedMessage {...M.createPlanTitle} />
      </Text>

      <View style={styles.card}>
        <Text style={styles.subtitle}>
          <FormattedMessage {...M.createPlanGoalLabel} />
        </Text>
        <View style={styles.selectorRow}>
          {GOALS.map((g) => (
            <Pressable
              key={g}
              testID={`goal-option-${g}`}
              style={[styles.selectorOption, goal === g && styles.selectorOptionSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: goal === g }}
              onPress={() => setGoal(g)}
            >
              <Text
                style={[
                  styles.selectorOptionText,
                  goal === g && styles.selectorOptionTextSelected,
                ]}
              >
                {intl.formatMessage({ id: GOAL_LABEL_IDS[g] })}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.subtitle}>
          <FormattedMessage {...M.createPlanDaysPerWeekLabel} />
        </Text>
        <TextInput
          testID="days-per-week-input"
          style={styles.input}
          value={daysPerWeek}
          onChangeText={setDaysPerWeek}
          keyboardType="number-pad"
          editable={!submitting}
        />

        <Text style={styles.subtitle}>
          <FormattedMessage {...M.createPlanSessionDurationLabel} />
        </Text>
        <TextInput
          testID="session-duration-input"
          style={styles.input}
          value={sessionDurationMinutes}
          onChangeText={setSessionDurationMinutes}
          keyboardType="number-pad"
          editable={!submitting}
        />

        <Text style={styles.subtitle}>
          <FormattedMessage {...M.createPlanLocationLabel} />
        </Text>
        <View style={styles.selectorRow}>
          {LOCATIONS.map((loc) => (
            <Pressable
              key={loc}
              testID={`location-option-${loc}`}
              style={[styles.selectorOption, location === loc && styles.selectorOptionSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected: location === loc }}
              onPress={() => setLocation(loc)}
            >
              <Text
                style={[
                  styles.selectorOptionText,
                  location === loc && styles.selectorOptionTextSelected,
                ]}
              >
                {intl.formatMessage({ id: LOCATION_LABEL_IDS[loc] })}
              </Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          testID="submit-btn"
          style={[styles.btn, submitting && styles.btnDisabled]}
          accessibilityRole="button"
          disabled={submitting}
          onPress={handleSubmit}
        >
          {submitting ? (
            <ActivityIndicator color={styles.btnText.color} />
          ) : (
            <Text style={styles.btnText}>
              <FormattedMessage {...M.createPlanSubmit} />
            </Text>
          )}
        </Pressable>

        {error && (
          <Text style={styles.errorText} accessibilityRole="alert" testID="create-plan-error">
            {error}
          </Text>
        )}
      </View>
    </ScrollView>
  );
}
