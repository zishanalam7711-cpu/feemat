import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING } from "@/src/lib/theme";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/lib/auth";

export default function SignupScreen() {
  const params = useLocalSearchParams<{ role?: string }>();
  const role: "teacher" | "student" = (params.role as any) === "teacher" ? "teacher" : "student";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!name.trim()) return setErr("Please enter your name");
    if (!email.trim()) return setErr("Please enter email");
    if (password.length < 6) return setErr("Password must be at least 6 characters");
    setLoading(true);
    try {
      await signUp(email.trim().toLowerCase(), password, name.trim(), role);
      // routed by gate
    } catch (e: any) {
      setErr(e?.message || "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.hTitle}>{role === "teacher" ? "Teacher Sign Up" : "Student Sign Up"}</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create your account</Text>
          <Text style={styles.sub}>You'll be signed in as a {role}.</Text>

          <View style={{ gap: SPACING.lg, marginTop: SPACING.xl }}>
            <Input testID="signup-name-input" label="Full Name" value={name} onChangeText={setName}
              placeholder={role === "teacher" ? "Ms. Priya Sharma" : "Rahul Kumar"} />
            <Input testID="signup-email-input" label="Email" value={email} onChangeText={setEmail}
              autoCapitalize="none" keyboardType="email-address" placeholder="you@school.com" />
            <Input testID="signup-password-input" label="Password (min 6)" value={password} onChangeText={setPassword}
              secureTextEntry placeholder="•••••••" />
            {err ? <Text style={styles.err} testID="signup-error">{err}</Text> : null}
            <Button testID="signup-submit-button" title="Create Account" loading={loading} onPress={submit} />
          </View>

          <Pressable
            testID="go-login-btn"
            onPress={() => router.replace({ pathname: "/(auth)/login", params: { role } })}
            style={{ marginTop: SPACING.xl }}
          >
            <Text style={styles.link}>
              Already have an account? <Text style={{ fontWeight: "700" }}>Log In</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md,
  },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  body: { padding: SPACING.xl, paddingBottom: SPACING.xxl },
  title: { fontSize: 28, fontWeight: "800", color: COLORS.onSurface },
  sub: { color: COLORS.onSurfaceSecondary, marginTop: 6 },
  err: { color: COLORS.error, fontSize: 13 },
  link: { color: COLORS.brand, textAlign: "center", fontSize: 15 },
});
