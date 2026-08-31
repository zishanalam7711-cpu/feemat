import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Linking } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";
import { Button } from "@/src/components/Button";

export default function TeacherView() {
  const { teacherId } = useLocalSearchParams<{ teacherId: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [t, setT] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setT(await api(`/teachers/${teacherId}`)); } catch {}
    setLoading(false);
  }, [teacherId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onConnect = async () => {
    if (!t || t.connection_status !== "none") return;
    setBusy(true);
    try {
      await api("/requests", { method: "POST", body: { teacher_id: t.teacher_id } });
      await load();
    } catch {} finally { setBusy(false); }
  };

  if (loading || !t) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;

  const status: "none" | "pending" | "connected" = t.connection_status;
  const btnTitle =
    status === "connected" ? "Connected ✓" :
    status === "pending" ? "Request Sent" :
    "Add / Request to Join";
  const btnVariant: "primary" | "secondary" | "success" =
    status === "connected" ? "success" :
    status === "pending" ? "secondary" : "primary";

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <LinearGradient colors={["#7C3AED", "#EC4899"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color="#fff" /></Pressable>
        <View style={styles.heroBody}>
          <Avatar name={t.name} uri={t.photo_url} size={80} bg="rgba(255,255,255,0.22)" fg="#fff" />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.name} testID="tp-name">{t.name}</Text>
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
          </View>
          <Text style={styles.tid} testID="tp-id">{t.teacher_id}</Text>
          <Text style={styles.coaching}>{t.coaching_name || "Independent Teacher"}</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        {t.bio ? <Section title="About">
          <Text style={styles.body}>{t.bio}</Text>
        </Section> : null}

        <Section title="Teaching">
          <Row label="Subjects" value={(t.subjects || []).join(", ") || "—"} />
          <Row label="Classes" value={(t.classes || []).join(", ") || "—"} />
          <Row label="Mode" value={t.teaching_mode || "—"} />
          <Row label="Timings" value={t.class_timings || "—"} />
          <Row label="Working Days" value={(t.working_days || []).join(", ") || "—"} />
        </Section>

        <Section title="Qualification & Experience">
          <Row label="Qualification" value={t.qualification || "—"} />
          <Row label="Experience" value={t.experience || "—"} />
          {t.achievements ? <Row label="Achievements" value={t.achievements} /> : null}
        </Section>

        <Section title="Coaching">
          <Row label="Address" value={t.coaching_address || "—"} />
          <Row label="City" value={t.city || "—"} />
        </Section>

        <Section title="Contact">
          {t.phone ? <Pressable onPress={() => Linking.openURL(`tel:${t.phone}`)}><Row label="Phone" value={t.phone} /></Pressable> : <Row label="Phone" value="Private" />}
          {t.email ? <Row label="Email" value={t.email} /> : <Row label="Email" value="Private" />}
          {t.upi_id ? <Row label="UPI" value={t.upi_id} /> : null}
        </Section>
      </ScrollView>

      <View style={[styles.stickyCta, { paddingBottom: insets.bottom + SPACING.md }]}>
        <Button
          testID="dynamic-connect-btn"
          title={btnTitle}
          variant={btnVariant}
          disabled={status !== "none"}
          loading={busy}
          onPress={onConnect}
        />
      </View>
    </View>
  );
}

function Section({ title, children }: any) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectTitle}>{title}</Text>
      {children}
    </View>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowKV}>
      <Text style={styles.k}>{label}</Text>
      <Text style={styles.v} numberOfLines={3}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: { padding: SPACING.lg, paddingBottom: SPACING.xl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroBody: { alignItems: "center", gap: 6, marginTop: SPACING.md },
  name: { color: "#fff", fontSize: 22, fontWeight: "800" },
  tid: { color: "rgba(255,255,255,0.9)", fontWeight: "600" },
  coaching: { color: "rgba(255,255,255,0.85)" },
  section: { margin: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider, gap: SPACING.sm },
  sectTitle: { fontSize: 13, fontWeight: "800", color: COLORS.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  body: { color: COLORS.onSurface, lineHeight: 20 },
  rowKV: { flexDirection: "row", justifyContent: "space-between", gap: SPACING.md, paddingVertical: 6 },
  k: { color: COLORS.muted, fontSize: 13, flex: 1 },
  v: { color: COLORS.onSurface, fontWeight: "600", fontSize: 13, flex: 2, textAlign: "right" },
  stickyCta: { position: "absolute", left: 0, right: 0, bottom: 0, padding: SPACING.lg, backgroundColor: "rgba(255,255,255,0.95)", borderTopWidth: 1, borderTopColor: COLORS.divider },
});
