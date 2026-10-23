import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/lib/auth";
import { GradientBg, Logo, GradBtn, AuthField } from "@/src/components/ui";

export default function SignupScreen() {
  const params = useLocalSearchParams<{ role?: string }>();
  const initial: "teacher" | "student" = (params.role as any) === "student" ? "student" : "teacher";
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp } = useAuth();

  const [role, setRole] = useState<"teacher" | "student">(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setErr(null);
    if (!name.trim() || !email.trim() || !password) return setErr("Please fill all fields");
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
      return setErr("Password must be at least 8 characters and include a letter and a number");
    if (password !== confirm) return setErr("The two passwords do not match");
    setLoading(true);
    try {
      const u: any = await signUp(email.trim().toLowerCase(), password, name.trim(), role, role === "student" ? code.trim() : undefined);
      if (role === "student" && code.trim()) {
        if (u?.claimed) Alert.alert("Record linked 🎉", "The fees, attendance and marks your teacher entered are now in your account.");
        else Alert.alert("Code not used", (u?.claim_error || "The code was incorrect") + "\n\nYour account was created. You can try the code again later from the Home screen (\"Teacher code\").");
      }
      // routed by gate
    } catch (e: any) {
      setErr(e?.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <GradientBg>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={{ paddingHorizontal: 24 }}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ width: 40 }}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </Pressable>
            <View style={{ alignItems: "center", marginBottom: 18 }}>
              <Logo size={96} />
            </View>
          </View>

          <View style={[styles.panel, { paddingBottom: insets.bottom + 28 }]}>
            <Text style={styles.h1}>Create Account</Text>
            <Text style={styles.sub}>Join Feemat and manage your fees easily</Text>

            <View style={styles.seg}>
              {(["teacher", "student"] as const).map((r) => (
                <Pressable key={r} onPress={() => setRole(r)} style={[styles.segBtn, role === r && styles.segOn]} testID={`role-${r}`}>
                  <Text style={[styles.segTxt, role === r && { color: "#fff" }]}>{r === "teacher" ? "Teacher" : "Student"}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ gap: 12, marginTop: 16 }}>
              <AuthField dark testID="signup-name-input" icon="person-outline" placeholder="Full Name" value={name} onChangeText={setName} />
              <AuthField dark testID="signup-email-input" icon="mail-outline" placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
              <AuthField dark testID="signup-password-input" icon="lock-closed-outline" placeholder="Password (8+, letter + number)" value={password} onChangeText={setPassword} secure />
              <AuthField dark testID="signup-confirm-input" icon="lock-closed-outline" placeholder="Confirm Password" value={confirm} onChangeText={setConfirm} secure />
              {role === "student" ? (
                <View>
                  <AuthField dark testID="signup-code-input" icon="key-outline" placeholder="Teacher code (if you have one)" value={code} onChangeText={setCode} autoCapitalize="characters" />
                  <Text style={styles.help}>If your teacher already created your record, enter the code here. Otherwise leave it empty.</Text>
                </View>
              ) : null}
            </View>

            {err ? <Text style={styles.err} testID="signup-error">{err}</Text> : null}

            <GradBtn testID="signup-submit" title="Create Account" onPress={onSubmit} loading={loading} style={{ marginTop: 18 }} height={54} />

            <Pressable onPress={() => router.replace({ pathname: "/(auth)/login", params: { role } })} testID="goto-login" style={{ marginTop: 18 }}>
              <Text style={styles.bottom}>Already have an account? <Text style={styles.link}>Login</Text></Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBg>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: "#fff", borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 24 },
  h1: { fontSize: 24, fontWeight: "800", color: "#0F172A" },
  sub: { color: "#64748B", fontSize: 13, marginTop: 4 },
  seg: { flexDirection: "row", backgroundColor: "#EEF4FF", borderRadius: 14, padding: 4, marginTop: 16 },
  segBtn: { flex: 1, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: "#1F6BFF" },
  segTxt: { color: "#475569", fontWeight: "800", fontSize: 14 },
  help: { color: "#64748B", fontSize: 12, marginTop: 6 },
  err: { color: "#DC2626", fontSize: 13, marginTop: 12 },
  bottom: { textAlign: "center", color: "#475569", fontSize: 13 },
  link: { color: "#1F6BFF", fontWeight: "800" },
});
