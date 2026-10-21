import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";
import { api, saveToken } from "@/src/lib/api";

const strongEnough = (pw: string) => pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);

// Logged-in password change. Other phones/sessions stop working; this phone gets a fresh token.
export function ChangePasswordCard() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [nw2, setNw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErr(null);
    setOk(false);
    if (!cur) return setErr("Enter your current password");
    if (!strongEnough(nw)) return setErr("The new password must be at least 8 characters and include a letter and a number");
    if (nw !== nw2) return setErr("The two new passwords do not match");
    setLoading(true);
    try {
      const res = await api<{ token: string }>("/auth/change-password", {
        method: "POST",
        body: { current_password: cur, new_password: nw },
      });
      await saveToken(res.token);
      setOk(true);
      setCur(""); setNw(""); setNw2("");
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message || "Could not change the password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <Pressable onPress={() => { setOpen(!open); setErr(null); }} style={styles.row} testID="change-pw-toggle">
        <Ionicons name="lock-closed" size={18} color={COLORS.brand} />
        <Text style={styles.title}>Change password</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={COLORS.muted} />
      </Pressable>
      {ok ? <Text style={styles.ok}>Password changed ✅ Other devices will be signed out automatically.</Text> : null}
      {open && (
        <View style={{ gap: SPACING.md, marginTop: SPACING.md }}>
          <Input testID="cp-current" label="Current password" value={cur} onChangeText={setCur} secureTextEntry />
          <Input testID="cp-new" label="New password" value={nw} onChangeText={setNw} secureTextEntry placeholder="At least 8 characters, letter + number" />
          <Input testID="cp-new2" label="Confirm new password" value={nw2} onChangeText={setNw2} secureTextEntry />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Button testID="cp-submit" title="Change password" onPress={submit} loading={loading} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: SPACING.lg, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  title: { flex: 1, fontWeight: "700", color: COLORS.onSurface, fontSize: 15 },
  err: { color: COLORS.error, fontSize: 13 },
  ok: { color: "#059669", fontSize: 13, marginTop: SPACING.sm },
});
