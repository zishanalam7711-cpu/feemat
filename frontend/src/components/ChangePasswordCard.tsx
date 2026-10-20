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
    if (!cur) return setErr("Abhi ka password likho");
    if (!strongEnough(nw)) return setErr("Naya password kam se kam 8 akshar ka ho, usme letter aur number dono hon");
    if (nw !== nw2) return setErr("Dono naye password same nahi hain");
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
      setErr(e?.message || "Password nahi badla");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.card}>
      <Pressable onPress={() => { setOpen(!open); setErr(null); }} style={styles.row} testID="change-pw-toggle">
        <Ionicons name="lock-closed" size={18} color={COLORS.brand} />
        <Text style={styles.title}>Password badlo</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={COLORS.muted} />
      </Pressable>
      {ok ? <Text style={styles.ok}>Password badal gaya ✅ Dusre phones se apne aap logout ho jayega.</Text> : null}
      {open && (
        <View style={{ gap: SPACING.md, marginTop: SPACING.md }}>
          <Input testID="cp-current" label="Abhi ka password" value={cur} onChangeText={setCur} secureTextEntry />
          <Input testID="cp-new" label="Naya password" value={nw} onChangeText={setNw} secureTextEntry placeholder="Kam se kam 8 akshar, letter + number" />
          <Input testID="cp-new2" label="Naya password dobara" value={nw2} onChangeText={setNw2} secureTextEntry />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Button testID="cp-submit" title="Password badlo" onPress={submit} loading={loading} />
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
