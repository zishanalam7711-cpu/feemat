import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING } from "@/src/lib/theme";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";
import { api } from "@/src/lib/api";

export default function ForgotScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!email || pw.length < 6) return setErr("Enter email and new password (min 6).");
    setLoading(true);
    try {
      await api("/auth/forgot-password", { method: "POST", auth: false, body: { email: email.trim().toLowerCase(), new_password: pw } });
      setDone(true);
    } catch (e: any) {
      setErr(e?.message ?? "Failed");
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
        <Text style={styles.hTitle}>Reset Password</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: SPACING.xl }} keyboardShouldPersistTaps="handled">
          {done ? (
            <>
              <Text style={styles.title}>Password updated</Text>
              <Text style={styles.sub}>If the email exists, the password has been reset. You can log in now.</Text>
              <Button testID="back-to-login" title="Back to Login" onPress={() => router.replace("/(auth)/login")} style={{ marginTop: SPACING.xl }} />
            </>
          ) : (
            <>
              <Text style={styles.title}>Reset password</Text>
              <Text style={styles.sub}>Enter your email and a new password.</Text>
              <View style={{ gap: SPACING.lg, marginTop: SPACING.xl }}>
                <Input testID="forgot-email" label="Email" value={email} onChangeText={setEmail}
                  autoCapitalize="none" keyboardType="email-address" />
                <Input testID="forgot-pw" label="New password" value={pw} onChangeText={setPw} secureTextEntry />
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button testID="forgot-submit" title="Reset Password" onPress={submit} loading={loading} />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  title: { fontSize: 28, fontWeight: "800", color: COLORS.onSurface },
  sub: { color: COLORS.onSurfaceSecondary, marginTop: 6 },
  err: { color: COLORS.error, fontSize: 13 },
});
