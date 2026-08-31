import React, { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/lib/auth";

export default function LoginScreen() {
  const params = useLocalSearchParams<{ role?: string }>();
  const role: "teacher" | "student" = (params.role as any) === "teacher" ? "teacher" : "student";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setErr(null);
    if (!email || !password) return setErr("Enter email and password");
    setLoading(true);
    try {
      const u = await signIn(email.trim().toLowerCase(), password);
      if (u.role !== role) {
        setErr(`This account is a ${u.role} account.`);
      }
      // Layout gate will route based on actual role
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surface }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} testID="back-btn" hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={COLORS.onSurface} />
        </Pressable>
        <Text style={styles.hTitle}>{role === "teacher" ? "Teacher Login" : "Student Login"}</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.sub}>Sign in to your {role} account.</Text>

          <View style={{ gap: SPACING.lg, marginTop: SPACING.xl }}>
            <Input testID="email-input" label="Email" value={email} onChangeText={setEmail}
              autoCapitalize="none" keyboardType="email-address" placeholder="you@school.com" />
            <Input testID="password-input" label="Password" value={password} onChangeText={setPassword}
              secureTextEntry placeholder="•••••••" />
            {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}
            <Button testID="login-submit-button" title="Log In" loading={loading} onPress={onSubmit} />
          </View>

          <Pressable
            testID="go-signup-btn"
            onPress={() => router.replace({ pathname: "/(auth)/signup", params: { role } })}
            style={{ marginTop: SPACING.xl }}
          >
            <Text style={styles.link}>
              New here? <Text style={{ fontWeight: "700" }}>Create an account</Text>
            </Text>
          </Pressable>

          <Pressable
            testID="forgot-btn"
            onPress={() => router.push({ pathname: "/(auth)/forgot", params: { role } })}
            style={{ marginTop: SPACING.md }}
          >
            <Text style={styles.linkMuted}>Forgot password?</Text>
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
  linkMuted: { color: COLORS.muted, textAlign: "center", fontSize: 13 },
});
