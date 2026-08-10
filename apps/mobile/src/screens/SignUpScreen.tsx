/**
 * Mobile sign-up screen — email/password form + Google Sign-Up button.
 *
 * Mirrors LoginScreen but posts to `POST /auth/register`.
 * On success stores the session token and navigates home.
 *
 * kno/kInorA#445 — built to the Open Design screen `mobile-auth.html`, which
 * draws sign-in and create-account as one screen differing only in copy; both
 * therefore share `auth/AuthScreen.styles.ts` and the same inline error
 * treatment. See `LoginScreen.tsx` for why the modal `Alert` gave way to the
 * screen's banner and field hints, and why the Google handler kept its own.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useIntl } from "react-intl";
import { validateCredentials, type CredentialField } from "../auth/credentials";
import { setSessionToken } from "../auth/session-storage";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { colors } from "../theme/tokens";
import { styles } from "./auth/AuthScreen.styles";
import { AlertMark, BrandMark, GoogleMark } from "./auth/auth-icons";

type SignUpScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

export default function SignUpScreen({ navigation }: SignUpScreenProps) {
  const intl = useIntl();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<
    { field: CredentialField; message: string } | null
  >(null);

  const handleSignUp = async () => {
    setBanner(null);
    setFieldError(null);

    const validation = validateCredentials(email, password);
    if (!validation.valid) {
      setFieldError({
        field: validation.field,
        message: intl.formatMessage({
          id:
            validation.field === "email"
              ? "auth.validation.invalidEmail"
              : "auth.validation.passwordTooShort",
        }),
      });
      return;
    }

    setLoading(true);
    try {
      const base = process.env.API_BASE_URL ?? "http://localhost:4000";
      const res = await fetch(`${base}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: validation.email, password: validation.password }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setBanner(body.error ?? intl.formatMessage({ id: "auth.error.retry" }));
        return;
      }

      const session = (await res.json().catch(() => ({}))) as { token?: string };
      if (!session.token) {
        setBanner(intl.formatMessage({ id: "auth.error.noSession" }));
        return;
      }

      await setSessionToken(session.token);
      navigation.replace("Home");
    } catch {
      setBanner(intl.formatMessage({ id: "auth.error.network" }));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    // Same flow as Google sign-in — the API's social login endpoint handles
    // both new and existing users (links by verified email).
    try {
      const base = process.env.API_BASE_URL ?? "http://localhost:4000";
      const res = await fetch(`${base}/auth/social/login?provider=google`);

      if (!res.ok) {
        Alert.alert("Error", "Could not start Google sign-up.");
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { authorizationUrl?: string };
      if (!body.authorizationUrl) {
        Alert.alert("Error", "No authorization URL received.");
        return;
      }

      Alert.alert("Google Sign-Up", "Would open: " + body.authorizationUrl);
    } catch {
      Alert.alert("Network Error", "Could not reach the server.");
    }
  };

  const emailInvalid = fieldError?.field === "email" || banner !== null;
  const passwordInvalid = fieldError?.field === "password" || banner !== null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.brand}>
        <BrandMark />
        <Text style={styles.brandName}>
          {intl.formatMessage({ id: "marketing.title" })}
        </Text>
      </View>

      <Text style={styles.title}>
        {intl.formatMessage({ id: "auth.signup.title" })}
      </Text>
      <Text style={styles.subtitle}>
        {intl.formatMessage({ id: "auth.signup.subtitle" })}
      </Text>

      {banner ? (
        <View style={styles.banner} accessibilityRole="alert">
          <AlertMark />
          <Text style={styles.bannerText}>{banner}</Text>
        </View>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.label}>
          {intl.formatMessage({ id: "auth.emailLabel" })}
        </Text>
        <TextInput
          style={[styles.input, emailInvalid && styles.inputInvalid]}
          placeholder={intl.formatMessage({ id: "auth.emailPlaceholder" })}
          placeholderTextColor={colors.muted}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          editable={!loading}
        />
        {fieldError?.field === "email" ? (
          <View style={styles.hint}>
            <AlertMark size={12} />
            <Text style={styles.hintText}>{fieldError.message}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>
          {intl.formatMessage({ id: "auth.passwordLabel" })}
        </Text>
        <TextInput
          style={[styles.input, passwordInvalid && styles.inputInvalid]}
          placeholder={intl.formatMessage({ id: "auth.passwordPlaceholder" })}
          placeholderTextColor={colors.muted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="new-password"
          editable={!loading}
        />
        {fieldError?.field === "password" ? (
          <View style={styles.hint}>
            <AlertMark size={12} />
            <Text style={styles.hintText}>{fieldError.message}</Text>
          </View>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={handleSignUp}
        disabled={loading}
        accessibilityRole="button"
      >
        {loading ? <ActivityIndicator color={colors.accentFg} size="small" /> : null}
        <Text style={styles.primaryButtonText}>
          {intl.formatMessage({
            id: loading ? "auth.signup.pending" : "auth.signup.submit",
          })}
        </Text>
      </TouchableOpacity>

      <View style={styles.separator}>
        <View style={styles.separatorRule} />
        <Text style={styles.separatorLabel}>
          {intl.formatMessage({ id: "auth.separator" })}
        </Text>
        <View style={styles.separatorRule} />
      </View>

      <TouchableOpacity
        style={[styles.googleButton, loading && styles.buttonDisabled]}
        onPress={handleGoogleSignUp}
        disabled={loading}
        accessibilityRole="button"
      >
        <GoogleMark />
        <Text style={styles.googleButtonText}>
          {intl.formatMessage({ id: "auth.signup.google" })}
        </Text>
      </TouchableOpacity>

      <View style={styles.foot}>
        <TouchableOpacity
          onPress={() => navigation.navigate("Login")}
          accessibilityRole="button"
        >
          <Text style={styles.footText}>
            {intl.formatMessage({ id: "auth.signup.switchPrompt" })}{" "}
            <Text style={styles.footLink}>
              {intl.formatMessage({ id: "auth.signup.switchLink" })}
            </Text>
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
