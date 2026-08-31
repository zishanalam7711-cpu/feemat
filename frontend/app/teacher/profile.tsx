import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Switch, KeyboardAvoidingView, Platform, ActivityIndicator, Share } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";
import { useAuth } from "@/src/lib/auth";

export default function TeacherProfileScreen() {
  const insets = useSafeAreaInsets();
  const { signOut, user } = useAuth();
  const router = useRouter();
  const [t, setT] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setT(await api("/teacher/profile")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patch = (k: string, v: any) => setT((p: any) => ({ ...p, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body: any = { ...t };
      delete body.user_id; delete body.teacher_id; delete body.id; delete body.created_at; delete body.email;
      // csv arrays
      body.subjects = Array.isArray(t.subjects) ? t.subjects : String(t.subjects || "").split(",").map((s: string) => s.trim()).filter(Boolean);
      body.classes = Array.isArray(t.classes) ? t.classes : String(t.classes || "").split(",").map((s: string) => s.trim()).filter(Boolean);
      body.working_days = Array.isArray(t.working_days) ? t.working_days : String(t.working_days || "").split(",").map((s: string) => s.trim()).filter(Boolean);
      const updated = await api("/teacher/profile", { method: "PUT", body });
      setT(updated);
    } catch (e: any) {}
    setSaving(false);
  };

  const shareId = async () => {
    await Share.share({ message: `Join my class on FeeMat. My Teacher ID is ${t?.teacher_id}` });
  };

  if (loading || !t) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
        <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
          <Avatar name={t.name} uri={t.photo_url} size={72} />
          <Text style={styles.name} testID="my-teacher-name">{t.name}</Text>
          <Pressable style={styles.tidPill} onPress={shareId} testID="share-teacher-id">
            <Ionicons name="id-card" size={14} color={COLORS.brand} />
            <Text style={styles.tid}>{t.teacher_id}</Text>
            <Ionicons name="share-outline" size={14} color={COLORS.brand} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectTitle}>Personal</Text>
          <Input testID="p-name" label="Name" value={t.name || ""} onChangeText={(v) => patch("name", v)} />
          <Input label="Phone" value={t.phone || ""} onChangeText={(v) => patch("phone", v)} keyboardType="phone-pad" />
          <Input label="Photo URL" value={t.photo_url || ""} onChangeText={(v) => patch("photo_url", v)} autoCapitalize="none" />
          <Input label="Qualification" value={t.qualification || ""} onChangeText={(v) => patch("qualification", v)} />
          <Input label="Experience" value={t.experience || ""} onChangeText={(v) => patch("experience", v)} />
          <Input label="About / Bio" value={t.bio || ""} onChangeText={(v) => patch("bio", v)} multiline />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectTitle}>Coaching / School</Text>
          <Input label="Institute Name" value={t.coaching_name || ""} onChangeText={(v) => patch("coaching_name", v)} />
          <Input label="Address" value={t.coaching_address || ""} onChangeText={(v) => patch("coaching_address", v)} multiline />
          <Input label="City" value={t.city || ""} onChangeText={(v) => patch("city", v)} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectTitle}>Teaching</Text>
          <Input label="Subjects (comma separated)" value={Array.isArray(t.subjects) ? t.subjects.join(", ") : t.subjects || ""} onChangeText={(v) => patch("subjects", v)} />
          <Input label="Classes (comma separated)" value={Array.isArray(t.classes) ? t.classes.join(", ") : t.classes || ""} onChangeText={(v) => patch("classes", v)} />
          <Input label="Working days (Mon, Tue…)" value={Array.isArray(t.working_days) ? t.working_days.join(", ") : t.working_days || ""} onChangeText={(v) => patch("working_days", v)} />
          <Input label="Class timings" value={t.class_timings || ""} onChangeText={(v) => patch("class_timings", v)} />
          <Input label="Teaching mode (Online/Offline/Hybrid)" value={t.teaching_mode || "Offline"} onChangeText={(v) => patch("teaching_mode", v)} />
          <Input label="Achievements" value={t.achievements || ""} onChangeText={(v) => patch("achievements", v)} multiline />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectTitle}>Payment</Text>
          <Input label="UPI ID" value={t.upi_id || ""} onChangeText={(v) => patch("upi_id", v)} autoCapitalize="none" />
          <Input label="QR Image URL" value={t.qr_url || ""} onChangeText={(v) => patch("qr_url", v)} autoCapitalize="none" />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectTitle}>Privacy</Text>
          <View style={styles.switchRow}>
            <Text style={styles.switchLbl}>Show phone publicly</Text>
            <Switch value={!!t.public_phone} onValueChange={(v) => patch("public_phone", v)} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLbl}>Show email publicly</Text>
            <Switch value={!!t.public_email} onValueChange={(v) => patch("public_email", v)} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectTitle}>Reminders</Text>
          <ReminderControls />
        </View>

        <View style={{ padding: SPACING.lg, gap: SPACING.md }}>
          <Button testID="save-profile-btn" title="Save Changes" loading={saving} onPress={save} />
          <Button testID="logout-btn" title="Log Out" variant="secondary" onPress={async () => { await signOut(); router.replace("/"); }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function ReminderControls() {
  const [prefs, setPrefs] = React.useState<{ enabled_due: boolean; enabled_overdue: boolean } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  React.useEffect(() => { (async () => { try { setPrefs(await require("@/src/lib/api").api("/teacher/reminder-prefs")); } catch {} })(); }, []);
  const toggle = async (k: "enabled_due" | "enabled_overdue") => {
    if (!prefs) return;
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    try { await require("@/src/lib/api").api("/teacher/reminder-prefs", { method: "PUT", body: { [k]: next[k] } }); } catch {}
  };
  const runNow = async () => {
    setBusy(true);
    try {
      const res = await require("@/src/lib/api").api("/teacher/reminders/run", { method: "POST" });
      setMsg(`${res.fired} reminder${res.fired === 1 ? "" : "s"} sent today.`);
      setTimeout(() => setMsg(null), 4000);
    } catch {} finally { setBusy(false); }
  };
  if (!prefs) return null;
  return (
    <View style={{ gap: SPACING.sm }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: COLORS.onSurface, fontSize: 14 }}>Send fee-due reminders</Text>
        <Switch value={!!prefs.enabled_due} onValueChange={() => toggle("enabled_due")} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ color: COLORS.onSurface, fontSize: 14 }}>Send overdue reminders</Text>
        <Switch value={!!prefs.enabled_overdue} onValueChange={() => toggle("enabled_overdue")} />
      </View>
      <Button testID="send-reminders-now" title={busy ? "Sending…" : "Send Reminders Now"} variant="secondary" onPress={runNow} loading={busy} />
      {msg ? <Text style={{ color: COLORS.success, fontSize: 12 }}>{msg}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { alignItems: "center", padding: SPACING.xl, gap: SPACING.sm, backgroundColor: COLORS.surface },
  name: { fontSize: 22, fontWeight: "800", color: COLORS.onSurface },
  tidPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: SPACING.md, paddingVertical: 6, backgroundColor: COLORS.brandSoft, borderRadius: RADIUS.pill },
  tid: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  section: { padding: SPACING.lg, gap: SPACING.md, marginTop: SPACING.md, backgroundColor: COLORS.surface, marginHorizontal: SPACING.md, borderRadius: RADIUS.md },
  sectTitle: { fontSize: 14, fontWeight: "800", color: COLORS.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLbl: { color: COLORS.onSurface, fontSize: 14 },
});
