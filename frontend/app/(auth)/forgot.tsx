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
    if (!/^\S+@\S+\.\S+$/.test(e)) return setErr("Sahi email likho");
    setLoading(true);
    try {
      const res: any = await api("/auth/forgot-password", { method: "POST", auth: false, body: { email: e } });
      setInfo(res?.message || "OTP bhej diya gaya hai.");
      setStep("reset");
      setCooldown(60);
    } catch (ex: any) {
      setErr(ex?.message ?? "OTP nahi bheja ja saka");
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
      setInfo("Naya OTP bhej diya gaya hai (agar email registered hai).");
      setCooldown(60);
    } catch (ex: any) {
      setErr(ex?.message ?? "OTP nahi bheja ja saka");
    } finally {
      setLoading(false);
    }
  };

  const reset = async () => {
    setErr(null);
    if (!/^\d{6}$/.test(otp.trim())) return setErr("6 digit ka OTP likho");
    if (!strongEnough(pw)) return setErr("Naya password kam se kam 8 akshar ka ho, usme letter aur number dono hon");
    if (pw !== pw2) return setErr("Dono password same nahi hain");
    setLoading(true);
    try {
      await api("/auth/reset-password", {
        method: "POST", auth: false,
        body: { email: email.trim().toLowerCase(), otp: otp.trim(), new_password: pw },
      });
      setStep("done");
    } catch (ex: any) {
      setErr(ex?.message ?? "Password nahi badla");
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
              <Text style={styles.title}>Password badal gaya ✅</Text>
              <Text style={styles.sub}>Ab naye password se login karo. Purane sab login apne aap band ho gaye hain.</Text>
              <Button testID="back-to-login" title="Login par jao" onPress={() => router.replace("/")} style={{ marginTop: SPACING.xl }} />
            </>
          ) : step === "email" ? (
            <>
              <Text style={styles.title}>Password bhool gaye?</Text>
              <Text style={styles.sub}>Apna email likho. Hum 6 digit ka OTP bhejenge.</Text>
              <View style={{ gap: SPACING.lg, marginTop: SPACING.xl }}>
                <Input testID="forgot-email" label="Email" value={email} onChangeText={setEmail}
                  autoCapitalize="none" keyboardType="email-address" placeholder="you@school.com" />
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button testID="forgot-send" title="OTP bhejo" onPress={sendOtp} loading={loading} />
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>OTP daalo</Text>
              <Text style={styles.sub}>{info}</Text>
              <View style={{ gap: SPACING.lg, marginTop: SPACING.xl }}>
                <Input testID="forgot-otp" label="6 digit OTP" value={otp} onChangeText={setOtp}
                  keyboardType="number-pad" maxLength={6} placeholder="••••••" />
                <Input testID="forgot-pw" label="Naya password" value={pw} onChangeText={setPw} secureTextEntry
                  placeholder="Kam se kam 8 akshar, letter + number" />
                <Input testID="forgot-pw2" label="Naya password dobara" value={pw2} onChangeText={setPw2} secureTextEntry />
                {err ? <Text style={styles.err}>{err}</Text> : null}
                <Button testID="forgot-submit" title="Password badlo" onPress={reset} loading={loading} />
                <Pressable onPress={resend} disabled={cooldown > 0 || loading}>
                  <Text style={[styles.resend, (cooldown > 0 || loading) && { opacity: 0.5 }]}>
                    {cooldown > 0 ? `Naya OTP ${cooldown} second baad maang sakte ho` : "OTP nahi mila? Dobara bhejo"}
                  </Text>
                </Pressable>
                <Pressable onPress={() => { setStep("email"); setErr(null); setOtp(""); }}>
                  <Text style={[styles.resend, { color: COLORS.muted }]}>Email badlo</Text>
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
