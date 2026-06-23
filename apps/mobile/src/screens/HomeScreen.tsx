/**
 * Mobile home screen — placeholder for the authenticated main view.
 *
 * In a complete app this would show the user's training plans, dashboard,
 * etc. For PR4 it serves as the navigation target that confirms the auth
 * flow successfully reached the protected area.
 */

import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { deleteSessionToken } from "../auth/session-storage";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

type HomeScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const handleLogout = async () => {
    await deleteSessionToken();
    navigation.replace("Login");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to kInorA</Text>
      <Text style={styles.subtitle}>Personalized training powered by AI</Text>
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: "#555",
    marginBottom: 32,
  },
  logoutButton: {
    padding: 12,
  },
  logoutText: {
    color: "#0070f3",
    fontSize: 16,
    fontWeight: "600",
  },
});
