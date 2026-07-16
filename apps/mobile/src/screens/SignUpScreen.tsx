/**
 * Mobile sign-up screen — email/password form + Google Sign-Up button.
 *
 * Mirrors LoginScreen but posts to `POST /auth/register`.
 * On success stores the session token and navigates home.
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
import { styles } from "./SignUpScreen.styles";

type SignUpScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

export default function SignUpScreen({ navigation }: SignUpScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSignUp = async () => {
    const validation = validateCredentials(email, password);
    if (!validation.valid) {
      Alert.alert("Validation Error", validation.error);
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
      Alert.alert("Sign Up Failed", body.error ?? "Please try again.");
        return;
      }

      const session = (await res.json().catch(() => ({}))) as { token?: string };
      if (!session.token) {
        Alert.alert("Sign Up Failed", "No session received.");
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sign up</Text>

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
        autoComplete="new-password"
      />

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={handleSignUp}
        disabled={loading}
      >
        <Text style={styles.primaryButtonText}>
          {loading ? "Signing up..." : "Sign up"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.googleButton}
        onPress={handleGoogleSignUp}
      >
        <Text style={styles.googleButtonText}>Sign up with Google</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate("Login")}>
        <Text style={styles.switchLink}>
          Already have an account? Log in
        </Text>
      </TouchableOpacity>
    </View>
  );
}
