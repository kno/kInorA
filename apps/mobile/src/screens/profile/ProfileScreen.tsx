/**
 * ProfileScreen — mobile profile screen (17c-profile-body-metrics, PR 5,
 * greenfield). Name/goal/experience/selfDescribedSex/height plus the
 * bodyweight series, mirroring web's `/profile` under the SAME validation
 * rules — never re-implements the API's enum/bound checks, only surfaces
 * its 422 (see `user-profile-client.ts` / `weight-entry-client.ts`).
 * Selector fields use `ClientCreatePlanScreen`'s chip picker pattern (RN has
 * no native `<select>`), extended to allow "not chosen yet" (no chip
 * selected) for these nullable profile fields.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { FormattedMessage, useIntl } from "react-intl";
import type {
  ExperienceLevel,
  PlanGoal,
  SelfDescribedSex,
  WeightEntryDTO,
} from "@kinora/contracts";

import {
  fetchUserProfile as defaultFetchUserProfile,
  updateUserProfile as defaultUpdateUserProfile,
  type ClientOptions as ProfileClientOptions,
  type ProfileFormInput,
} from "../../api/user-profile-client";
import {
  createWeightEntry as defaultCreateWeightEntry,
  fetchWeightEntries as defaultFetchWeightEntries,
  type ClientOptions as WeightClientOptions,
} from "../../api/weight-entry-client";
import { messages as M } from "./messages";
import { styles } from "./ProfileScreen.styles";

const GOALS: PlanGoal[] = ["strength", "hypertrophy", "fat_loss", "general_fitness"];
const GOAL_LABEL_IDS: Record<PlanGoal, string> = {
  strength: "wizard.goal.strength.label",
  hypertrophy: "wizard.goal.hypertrophy.label",
  fat_loss: "wizard.goal.fatLoss.label",
  general_fitness: "wizard.goal.generalFitness.label",
};

const EXPERIENCE_LEVELS: ExperienceLevel[] = ["beginner", "intermediate", "advanced"];
const EXPERIENCE_LABEL_IDS: Record<ExperienceLevel, string> = {
  beginner: "profile.experience.beginner",
  intermediate: "profile.experience.intermediate",
  advanced: "profile.experience.advanced",
};

/** ONE merged field (decisions 9/10) — never a two-field sex/gender split. */
const SELF_DESCRIBED_SEX_OPTIONS: SelfDescribedSex[] = [
  "female",
  "male",
  "non_binary",
  "other",
  "prefer_not_to_say",
];
const SELF_DESCRIBED_SEX_LABEL_IDS: Record<SelfDescribedSex, string> = {
  female: "profile.form.selfDescribedSex.female",
  male: "profile.form.selfDescribedSex.male",
  non_binary: "profile.form.selfDescribedSex.nonBinary",
  other: "profile.form.selfDescribedSex.other",
  prefer_not_to_say: "profile.form.selfDescribedSex.preferNotToSay",
};

type SaveStatus = "idle" | "saving" | "saved" | "error";
type WeightStatus = "idle" | "saving" | "error";

export interface ProfileScreenProps {
  fetchUserProfile?: typeof defaultFetchUserProfile;
  updateUserProfile?: typeof defaultUpdateUserProfile;
  fetchWeightEntries?: typeof defaultFetchWeightEntries;
  createWeightEntry?: typeof defaultCreateWeightEntry;
  apiBaseUrl?: string;
  getToken?: () => Promise<string | null>;
}

export default function ProfileScreen({
  fetchUserProfile,
  updateUserProfile,
  fetchWeightEntries,
  createWeightEntry,
  apiBaseUrl,
  getToken,
}: ProfileScreenProps) {
  const intl = useIntl();

  const clientOptions: ProfileClientOptions & WeightClientOptions = { apiBaseUrl, getToken };

  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState<PlanGoal | null>(null);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | null>(null);
  const [selfDescribedSex, setSelfDescribedSex] = useState<SelfDescribedSex | null>(null);
  const [heightCm, setHeightCm] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");

  const [entries, setEntries] = useState<WeightEntryDTO[]>([]);
  const [weightKg, setWeightKg] = useState("");
  const [weightStatus, setWeightStatus] = useState<WeightStatus>("idle");
  const [weightErrorKey, setWeightErrorKey] = useState<string | null>(null);
  const [showVolumeShiftNotice, setShowVolumeShiftNotice] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      const [profileResult, entriesResult] = await Promise.all([
        (fetchUserProfile ?? defaultFetchUserProfile)(clientOptions),
        (fetchWeightEntries ?? defaultFetchWeightEntries)(clientOptions),
      ]);
      if (!mountedRef.current) return;
      if (profileResult.kind === "ok") {
        setName(profileResult.profile.name);
        setGoal(profileResult.profile.goal);
        setExperienceLevel(profileResult.profile.experienceLevel);
        setSelfDescribedSex(profileResult.profile.selfDescribedSex);
        setHeightCm(profileResult.profile.heightCm != null ? String(profileResult.profile.heightCm) : "");
      }
      if (entriesResult.kind === "ok") {
        setEntries(entriesResult.entries);
      }
      setLoaded(true);
    })();
    // clientOptions is derived from stable props; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUserProfile, fetchWeightEntries]);

  const handleSave = useCallback(async () => {
    if (saveStatus === "saving") return;
    setSaveStatus("saving");
    const input: ProfileFormInput = {
      name,
      goal,
      experienceLevel,
      selfDescribedSex,
      heightCm: heightCm.trim() === "" ? null : Number(heightCm),
    };
    const result = await (updateUserProfile ?? defaultUpdateUserProfile)(input, clientOptions);
    if (!mountedRef.current) return;
    if (result.kind === "ok") {
      setName(result.profile.name);
      setGoal(result.profile.goal);
      setExperienceLevel(result.profile.experienceLevel);
      setSelfDescribedSex(result.profile.selfDescribedSex);
      setHeightCm(result.profile.heightCm != null ? String(result.profile.heightCm) : "");
      setSaveStatus("saved");
    } else {
      // Mirrors web `ProfileForm`: every rejection (blank name, invalid enum,
      // out-of-range height) surfaces the same generic notice — the API's
      // machine-readable `error` is not duplicated into per-field copy here.
      setSaveStatus("error");
    }
    // clientOptions derived from stable props; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus, name, goal, experienceLevel, selfDescribedSex, heightCm, updateUserProfile]);

  const handleAddWeight = useCallback(async () => {
    if (weightStatus === "saving") return;
    const parsedWeight = Number(weightKg);
    if (!Number.isFinite(parsedWeight) || parsedWeight <= 0) {
      setWeightStatus("error");
      setWeightErrorKey(M.invalidWeight.id);
      return;
    }
    setWeightStatus("saving");
    const result = await (createWeightEntry ?? defaultCreateWeightEntry)(
      { weightKg: parsedWeight },
      clientOptions,
    );
    if (!mountedRef.current) return;
    if (result.kind === "ok") {
      setEntries((current) =>
        [result.entry, ...current].sort(
          (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
        ),
      );
      setWeightKg("");
      setWeightStatus("idle");
      setWeightErrorKey(null);
      if (result.wasFirstEntry) setShowVolumeShiftNotice(true);
    } else {
      setWeightStatus("error");
      setWeightErrorKey(
        result.kind === "validation_error" && result.message === "invalid_recorded_at"
          ? M.invalidDate.id
          : result.kind === "validation_error" && result.message === "invalid_weight_kg"
            ? M.invalidWeight.id
            : M.weightError.id,
      );
    }
    // clientOptions derived from stable props; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightStatus, weightKg, createWeightEntry]);

  if (!loaded) {
    return (
      <View style={styles.centered} testID="profile-loading">
        <Text style={styles.title}>
          <FormattedMessage {...M.heading} />
        </Text>
      </View>
    );
  }

  function selectorRow<T extends string>(
    field: string,
    options: readonly T[],
    labelIds: Record<T, string>,
    selected: T | null,
    onSelect: (value: T) => void,
  ) {
    return (
      <View style={styles.selectorRow}>
        {options.map((value) => (
          <Pressable
            key={value}
            testID={`${field}-option-${value}`}
            style={[styles.selectorOption, selected === value && styles.selectorOptionSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: selected === value }}
            onPress={() => onSelect(value)}
          >
            <Text
              style={[
                styles.selectorOptionText,
                selected === value && styles.selectorOptionTextSelected,
              ]}
            >
              {intl.formatMessage({ id: labelIds[value] })}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} testID="profile-screen">
      <Text style={styles.title}>
        <FormattedMessage {...M.heading} />
      </Text>

      <View style={styles.card}>
        <Text style={styles.subtitle}>
          <FormattedMessage {...M.nameLabel} />
        </Text>
        <TextInput
          testID="profile-name-input"
          style={styles.input}
          value={name}
          placeholder={intl.formatMessage(M.namePlaceholder)}
          onChangeText={(value) => {
            setName(value);
            setSaveStatus("idle");
          }}
        />

        <Text style={styles.subtitle}>
          <FormattedMessage {...M.goalLabel} />
        </Text>
        {selectorRow("goal", GOALS, GOAL_LABEL_IDS, goal, (value) => {
          setGoal(value);
          setSaveStatus("idle");
        })}

        <Text style={styles.subtitle}>
          <FormattedMessage {...M.experienceLabel} />
        </Text>
        {selectorRow("experience", EXPERIENCE_LEVELS, EXPERIENCE_LABEL_IDS, experienceLevel, (value) => {
          setExperienceLevel(value);
          setSaveStatus("idle");
        })}

        <Text style={styles.subtitle}>
          <FormattedMessage {...M.selfDescribedSexLabel} />
        </Text>
        {selectorRow(
          "self-described-sex",
          SELF_DESCRIBED_SEX_OPTIONS,
          SELF_DESCRIBED_SEX_LABEL_IDS,
          selfDescribedSex,
          (value) => {
            setSelfDescribedSex(value);
            setSaveStatus("idle");
          },
        )}

        <Text style={styles.subtitle}>
          <FormattedMessage {...M.heightCmLabel} />
        </Text>
        <TextInput
          testID="profile-height-input"
          style={styles.input}
          value={heightCm}
          placeholder={intl.formatMessage(M.heightCmPlaceholder)}
          keyboardType="number-pad"
          onChangeText={(value) => {
            setHeightCm(value);
            setSaveStatus("idle");
          }}
        />

        <Pressable
          testID="profile-save-btn"
          style={[styles.btn, saveStatus === "saving" && styles.btnDisabled]}
          accessibilityRole="button"
          disabled={saveStatus === "saving"}
          onPress={handleSave}
        >
          <Text style={styles.btnText}>
            <FormattedMessage {...(saveStatus === "saving" ? M.saving : M.save)} />
          </Text>
        </Pressable>

        {saveStatus === "saved" && (
          <Text style={styles.statusText} accessibilityRole="text" testID="profile-status">
            <FormattedMessage {...M.saved} />
          </Text>
        )}
        {saveStatus === "error" && (
          <Text style={styles.errorText} accessibilityRole="alert" testID="profile-error">
            <FormattedMessage {...M.error} />
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>
          <FormattedMessage {...M.weightEntryHeading} />
        </Text>

        {showVolumeShiftNotice && (
          <View style={styles.notice} testID="weight-volume-shift-notice">
            <Text style={styles.noticeText}>
              <FormattedMessage {...M.volumeShiftNotice} />
            </Text>
            <Pressable
              testID="weight-volume-shift-dismiss"
              accessibilityRole="button"
              onPress={() => setShowVolumeShiftNotice(false)}
            >
              <Text style={styles.statusText}>
                <FormattedMessage {...M.dismiss} />
              </Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.subtitle}>
          <FormattedMessage {...M.weightLabel} />
        </Text>
        <TextInput
          testID="weight-entry-input"
          style={styles.input}
          value={weightKg}
          placeholder={intl.formatMessage(M.weightPlaceholder)}
          keyboardType="number-pad"
          onChangeText={(value) => {
            setWeightKg(value);
            setWeightStatus("idle");
            setWeightErrorKey(null);
          }}
        />

        <Pressable
          testID="weight-entry-submit-btn"
          style={[styles.btn, weightStatus === "saving" && styles.btnDisabled]}
          accessibilityRole="button"
          disabled={weightStatus === "saving"}
          onPress={handleAddWeight}
        >
          <Text style={styles.btnText}>
            <FormattedMessage {...(weightStatus === "saving" ? M.weightSaving : M.weightSubmit)} />
          </Text>
        </Pressable>

        {weightStatus === "error" && weightErrorKey && (
          <Text style={styles.errorText} accessibilityRole="alert" testID="weight-entry-error">
            {intl.formatMessage({ id: weightErrorKey })}
          </Text>
        )}

        <Text style={styles.subtitle}>
          <FormattedMessage {...M.listHeading} />
        </Text>
        {entries.length === 0 ? (
          <Text style={styles.errorText}>
            <FormattedMessage {...M.listEmpty} />
          </Text>
        ) : (
          <View testID="weight-entry-list">
            {entries.map((entry) => (
              <View key={entry.id} style={styles.entryRow} testID="weight-entry-row">
                <Text style={styles.entryText}>
                  {new Date(entry.recordedAt).toLocaleDateString()}
                </Text>
                <Text style={styles.entryText}>{entry.weightKg} kg</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
