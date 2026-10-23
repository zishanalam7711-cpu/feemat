import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { GradientBg, Logo, GradBtn, AuthField } from "@/src/components/ui";

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
    <GradientBg>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 12, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={{ paddingHorizontal: 24 }}>
            <Pressable onPress={() => router.back()} hitSlop={12} style={{ width: 40 }}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </Pressable>
            <View style={{ alignItems: "center", marginBottom: 18 }}><Logo size={96} /></View>
          </View>

          <View style={[styles.panel, { paddingBottom: insets.bottom + 28 }]}>
            {step === "done" ? (
              <>
                <Text style={styles.h1}>Password changed ✅</Text>
                <Text style={styles.sub}>You can now log in with your new password. All older sessions have been signed out.</Text>
                <GradBtn testID="back-to-login" title="Go to Login" onPress={() => router.replace("/")} style={{ marginTop: 22 }} />
              </>
            ) : step === "email" ? (
              <>
                <Text style={styles.h1}>Forgot your password?</Text>
                <Text style={styles.sub}>Enter your email. We will send you a 6-digit OTP.</Text>
                <View style={{ gap: 14, marginTop: 20 }}>
                  <AuthField dark testID="forgot-email" icon="mail-outline" placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
                  {err ? <Text style={styles.err}>{err}</Text> : null}
                  <GradBtn testID="forgot-send" title="Send OTP" onPress={sendOtp} loading={loading} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.h1}>Enter OTP</Text>
                <Text style={styles.sub}>{info}</Text>
                <View style={{ gap: 14, marginTop: 20 }}>
                  <AuthField dark testID="forgot-otp" icon="keypad-outline" placeholder="6-digit OTP" value={otp} onChangeText={setOtp} keyboardType="number-pad" maxLength={6} />
                  <AuthField dark testID="forgot-pw" icon="lock-closed-outline" placeholder="New password (8+, letter + number)" value={pw} onChangeText={setPw} secure />
                  <AuthField dark testID="forgot-pw2" icon="lock-closed-outline" placeholder="Confirm new password" value={pw2} onChangeText={setPw2} secure />
                  {err ? <Text style={styles.err}>{err}</Text> : null}
                  <GradBtn testID="forgot-submit" title="Change Password" onPress={reset} loading={loading} />
                  <Pressable onPress={resend} disabled={cooldown > 0 || loading}>
                    <Text style={[styles.link, (cooldown > 0 || loading) && { opacity: 0.5 }]}>
                      {cooldown > 0 ? `You can request a new OTP in ${cooldown}s` : "Didn't get it? Resend OTP"}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => { setStep("email"); setErr(null); setOtp(""); }}>
                    <Text style={[styles.link, { color: "#64748B" }]}>Change email</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </GradientBg>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, backgroundColor: "#fff", borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 22, paddingTop: 24 },
  h1: { fontSize: 24, fontWeight: "800", color: "#0F172A" },
  sub: { color: "#64748B", fontSize: 13, marginTop: 6, lineHeight: 19 },
  err: { color: "#DC2626", fontSize: 13 },
  link: { color: "#1F6BFF", textAlign: "center", fontWeight: "700", fontSize: 14 },
});
