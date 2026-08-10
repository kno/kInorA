/**
 * Mobile login screen — email/password form + Google Sign-In button.
 *
 * Uses the pure `validateCredentials` function for immediate form
 * validation and the social-login endpoint for the Google flow. On successful
 * email login, the session token is stored in SecureStore and the user is
 * navigated to the Home screen.
 *
 * kno/kInorA#445 — built to the Open Design screen `mobile-auth.html`: brand
 * row, title and supporting line, labelled fields, the separator and ghost
 * Google button, and the footer switch. Its `Estados` section draws failures
 * INLINE — a banner above the form for a rejected submission, a hint under the
 * offending field for a validation failure — and a submitting state on the
 * primary button, so those replace the modal `Alert` the form used to raise.
 *
 * This is a presentation change only. The same checks run in the same order,
 * decide the same outcomes and reach the same endpoints; `validateCredentials`
 * now also names the field its existing failure is about (see
 * `auth/credentials.ts`) so the message can sit where the screen draws it.
 * The Google handler is untouched, Alert included: it is a structural stub
 * that reports the authorization URL rather than opening it, and rewiring it
 * is not a restyle.
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

type LoginScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const intl = useIntl();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  /** A rejected submission — the screen's banner above the form. */
  const [banner, setBanner] = useState<string | null>(null);
  /** A failed local check — the screen's hint under the offending field. */
  const [fieldError, setFieldError] = useState<
    { field: CredentialField; message: string } | null
  >(null);

  const handleLogin = async () => {
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
      const res = await fetch(`${base}/auth/login`, {
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

  const handleGoogleSignIn = async () => {
    try {
      const base = process.env.API_BASE_URL ?? "http://localhost:4000";
      const res = await fetch(`${base}/auth/social/login?provider=google`);

      if (!res.ok) {
        Alert.alert("Error", "Could not start Google sign-in.");
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { authorizationUrl?: string };
      if (!body.authorizationUrl) {
        Alert.alert("Error", "No authorization URL received.");
        return;
      }

      // In a real app, open the authorizationUrl in an in-app browser or
      // AuthSession. For now, this is the structural wiring point.
      // Expo WebBrowser or AuthSession would handle the redirect back to
      // the deep link, which triggers the callback flow in App.tsx.
      Alert.alert("Google Sign-In", "Would open: " + body.authorizationUrl);
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
        {intl.formatMessage({ id: "auth.login.title" })}
      </Text>
      <Text style={styles.subtitle}>
        {intl.formatMessage({ id: "auth.login.subtitle" })}
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
          autoComplete="current-password"
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
        onPress={handleLogin}
        disabled={loading}
        accessibilityRole="button"
      >
        {loading ? <ActivityIndicator color={colors.accentFg} size="small" /> : null}
        <Text style={styles.primaryButtonText}>
          {intl.formatMessage({
            id: loading ? "auth.login.pending" : "auth.login.submit",
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
        onPress={handleGoogleSignIn}
        disabled={loading}
        accessibilityRole="button"
      >
        <GoogleMark />
        <Text style={styles.googleButtonText}>
          {intl.formatMessage({ id: "auth.login.google" })}
        </Text>
      </TouchableOpacity>

      <View style={styles.foot}>
        <TouchableOpacity
          onPress={() => navigation.navigate("SignUp")}
          accessibilityRole="button"
        >
          <Text style={styles.footText}>
            {intl.formatMessage({ id: "auth.login.switchPrompt" })}{" "}
            <Text style={styles.footLink}>
              {intl.formatMessage({ id: "auth.login.switchLink" })}
            </Text>
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
