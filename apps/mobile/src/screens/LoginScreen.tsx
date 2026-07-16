/**
 * Mobile login screen — email/password form + Google Sign-In button.
 *
 * Uses the pure `validateCredentials` function for immediate form
 * validation and `proxyMobileSocialCallback` for the social-login
 * callback flow. On successful email login, the session token is stored
 * in SecureStore and the user is navigated to the Home screen.
 */

import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
} from "react-native";
import { validateCredentials } from "../auth/credentials";
import { setSessionToken } from "../auth/session-storage";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { styles } from "./LoginScreen.styles";

type LoginScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

export default function LoginScreen({ navigation }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    const validation = validateCredentials(email, password);
    if (!validation.valid) {
      Alert.alert("Validation Error", validation.error);
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
      Alert.alert("Login Failed", body.error ?? "Please try again.");
        return;
      }

      const session = (await res.json().catch(() => ({}))) as { token?: string };
      if (!session.token) {
        Alert.alert("Login Failed", "No session received.");
        return;
      }

      await setSessionToken(session.token);
      navigation.replace("Home");
    } catch {
      Alert.alert("Network Error", "Could not reach the server.");
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Log in</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
      />

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={handleLogin}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>
          {loading ? "Logging in..." : "Log in"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.googleButton}
        onPress={handleGoogleSignIn}
      >
        <Text style={styles.googleButtonText}>Sign in with Google</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("SignUp")}>
        <Text style={styles.switchLink}>
          Don&apos;t have an account? Sign up
        </Text>
      </TouchableOpacity>
    </View>
  );
}
