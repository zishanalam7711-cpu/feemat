import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING } from "@/src/lib/theme";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";
import { api } from "@/src/lib/api";

const strongEnough = (pw: string) => pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);

export default function ForgotScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<"email" | "reset" | "done">("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sendOtp = async () => {
    setErr(null);
    const e = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr("Enter a valid email");
    setLoading(true);
    try {
      const res: any = await api("/auth/forgot-password", { method: "POST", auth: false, body: { email: e } });
      setInfo(res?.message || "OTP sent.");
      setStep("reset");
      setCooldown(60);
    } catch (ex: any) {
      setErr(ex?.message ?? "Could not send the OTP");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (cooldown > 0) return;
    setErr(null);
    setLoading(true);
    try {
      await api("/auth/forgot-password", { method: "POST", auth: false, body: { email: email.trim().toLowerCase() } });
      setInfo("A new OTP has been sent (if the email is registered).");
      setCooldown(60);
    } catch (ex: any) {
      setErr(ex?.message ?? "Could not send the OTP");
    } finally {
      setLoading(false);
    }
  };

  const reset = async () => {
    setErr(null);
    if (!/^\d{6}$/.test(otp.trim())) return setErr("Enter the 6-digit OTP");
    if (!strongEnough(pw)) return setErr("The new password must be at least 8 characters and include a letter and a number");
    if (pw !== pw2) return setErr("The two passwords do not match");
    setLoading(true);
    try {
      await api("/auth/reset-password", {
        method: "POST", auth: false,
        body: { email: email.trim().toLowerCase(), otp: otp.trim(), new_password: pw },
      });
      setStep("done");
    } catch (ex: any) {
      setErr(ex?.message ?? "Could not change the password");
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
          {step === "done" ? (
            <>
              <Text style={styles.title}>Password changed ✅</Text>
              <Text style={styles.sub}>You can now log in with your new password. All older sessions have been signed out.</Text>
              <Button testID="back-to-login" title="Go to Login" onPress={() => router.replace("/")} style={{ marginTop: SPACING.xl }} />
            </>
          ) : step === "email" ? (
            <>
              <Text style={styles.title}>Forgot your password?</Text>
              <Text style={styles.sub}>Enter your email. We will send you a 6-digit OTP.</Text>
              <View style={{ gap: SPACING.lg, marginTop: SPACING.xl }}>
                <Input testID="forgot-email" label="Email" value={email} onChangeText={setEmail}
                  autoCapitalize="none" keyboardType="email-address" placeholder="you@school.com" />
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button testID="forgot-send" title="Send OTP" onPress={sendOtp} loading={loading} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Enter OTP</Text>
              <Text style={styles.sub}>{info}</Text>
              <View style={{ gap: SPACING.lg, marginTop: SPACING.xl }}>
                <Input testID="forgot-otp" label="6 digit OTP" value={otp} onChangeText={setOtp}
                  keyboardType="number-pad" maxLength={6} placeholder="••••••" />
                <Input testID="forgot-pw" label="New password" value={pw} onChangeText={setPw} secureTextEntry
                  placeholder="At least 8 characters, letter + number" />
                <Input testID="forgot-pw2" label="Confirm new password" value={pw2} onChangeText={setPw2} secureTextEntry />
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button testID="forgot-submit" title="Change Password" onPress={reset} loading={loading} />
                <Pressable onPress={resend} disabled={cooldown > 0 || loading}>
                  <Text style={[styles.resend, (cooldown > 0 || loading) && { opacity: 0.5 }]}>
                    {cooldown > 0 ? `You can request a new OTP in ${cooldown}s` : "Didn't get it? Resend OTP"}
                  </Text>
                </Pressable>
                <Pressable onPress={() => { setStep("email"); setErr(null); setOtp(""); }}>
                  <Text style={[styles.resend, { color: COLORS.muted }]}>Change email</Text>
                </Pressable>
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
  sub: { color: COLORS.onSurfaceSecondary, marginTop: 6, lineHeight: 20 },
  err: { color: COLORS.error, fontSize: 13 },
  resend: { color: COLORS.brand, textAlign: "center", fontWeight: "700", fontSize: 14 },
});
