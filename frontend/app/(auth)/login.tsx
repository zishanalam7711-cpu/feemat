import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/lib/auth";
import { GradientBg, Logo, GradBtn, AuthField } from "@/src/components/ui";

export default function LoginScreen() {
  const params = useLocalSearchParams<{ role?: string }>();
  const role: "teacher" | "student" = (params.role as any) === "teacher" ? "teacher" : "student";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);

  const onSubmit = async () => {
    setErr(null);
    if (!email || !password) return setErr("Enter email and password");
    setLoading(true);
    const slowTimer = setTimeout(() => setSlow(true), 5000);
    try {
      // The server rejects the login if this account belongs to the other portal.
      await signIn(email.trim().toLowerCase(), password, role, remember);
      // Layout gate will route based on actual role
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
      setLoading(false);
    }
  };

  return (
    <GradientBg>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 24, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <Pressable onPress={() => router.back()} testID="back-btn" hitSlop={12} style={{ width: 40 }}>
            <Ionicons name="chevron-back" size={28} color="#fff" />
          </Pressable>

          <View style={{ alignItems: "center", marginTop: 4 }}>
            <Logo size={120} />
          </View>

          <View style={styles.portalPill}>
            <Ionicons name={role === "teacher" ? "school" : "person"} size={14} color="#fff" />
            <Text style={styles.portalTxt}>{role === "teacher" ? "Teacher Portal" : "Student Portal"}</Text>
          </View>

          <Text style={styles.h1}>Login to Your Account</Text>
          <Text style={styles.sub}>Enter your details to continue</Text>

          <View style={{ gap: 14, marginTop: 22 }}>
            <AuthField testID="login-email" icon="mail-outline" placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <AuthField testID="login-password" icon="lock-closed-outline" placeholder="Password" value={password} onChangeText={setPassword} secure />
          </View>

          <View style={styles.row}>
            <Pressable onPress={() => setRemember(!remember)} style={styles.rem} testID="remember-me">
              <View style={[styles.box, remember && styles.boxOn]}>{remember ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}</View>
              <Text style={styles.remTxt}>Remember Me</Text>
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: "/(auth)/forgot", params: { role } })} testID="forgot-link" hitSlop={8}>
              <Text style={styles.link}>Forgot Password?</Text>
            </Pressable>
          </View>

          {err ? <Text style={styles.err} testID="login-error">{err}</Text> : null}
          {loading && slow ? <Text style={styles.hint}>Connecting to the server... the first request can take up to a minute.</Text> : null}

          <GradBtn testID="login-submit" title="Login" onPress={onSubmit} loading={loading} style={{ marginTop: 20 }} height={54} />

          <View style={{ flex: 1 }} />
          <Pressable onPress={() => router.replace({ pathname: "/(auth)/signup", params: { role } })} testID="goto-signup" style={{ marginTop: 28 }}>
            <Text style={styles.bottom}>Don't have an account? <Text style={styles.link}>Create Account</Text></Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBg>
  );
}

const styles = StyleSheet.create({
  portalPill: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 14, paddingHorizontal: 14, height: 30, borderRadius: 15, backgroundColor: "rgba(53,200,255,0.18)" },
  portalTxt: { color: "#fff", fontWeight: "700", fontSize: 12 },
  h1: { color: "#fff", fontSize: 24, fontWeight: "800", marginTop: 20 },
  sub: { color: "rgba(255,255,255,0.75)", fontSize: 14, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  rem: { flexDirection: "row", alignItems: "center", gap: 8 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: "#8FB4FF", alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: "#1F6BFF", borderColor: "#1F6BFF" },
  remTxt: { color: "#fff", fontSize: 13 },
  link: { color: "#35C8FF", fontWeight: "700", fontSize: 13 },
  err: { color: "#FCA5A5", fontSize: 13, marginTop: 12 },
  hint: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 8 },
  bottom: { color: "rgba(255,255,255,0.85)", textAlign: "center", fontSize: 13 },
});
