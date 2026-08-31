import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Linking } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

export default function StudentFee() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { setLoading(true); try { setData(await api(`/connections/${id}`)); } catch {} setLoading(false); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;

  const c = data.connection;
  const t = data.teacher;
  const pct = c.total_fee > 0 ? Math.min(100, Math.round((c.paid / c.total_fee) * 100)) : 0;

  const payViaUpi = () => {
    if (!t.upi_id) return;
    const url = `upi://pay?pa=${t.upi_id}&pn=${encodeURIComponent(t.name)}&am=${c.due}&cu=INR&tn=${encodeURIComponent(c.admission_number)}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Fees & Attendance</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
        <View style={styles.card}>
          <Text style={styles.sect}>Fee Summary</Text>
          <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
            <Stat label="Total" value={inr(c.total_fee)} />
            <Stat label="Paid" value={inr(c.paid)} color={COLORS.success} />
            <Stat label="Due" value={inr(c.due)} color={c.due > 0 ? COLORS.error : COLORS.success} />
            <Stat label="Adv" value={inr(c.advance)} />
          </View>
          <View style={styles.progress}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
          <Text style={styles.pct}>{pct}% collected</Text>
        </View>

        {(t.upi_id || t.qr_url) && (
          <View style={styles.card}>
            <Text style={styles.sect}>Pay Your Teacher</Text>
            {t.upi_id ? <Text style={styles.kv}><Text style={styles.k}>UPI: </Text>{t.upi_id}</Text> : null}
            {t.qr_url ? <Image source={{ uri: t.qr_url }} style={{ width: 200, height: 200, alignSelf: "center", marginTop: SPACING.md, borderRadius: 12 }} /> : null}
            {t.upi_id && c.due > 0 ? (
              <Pressable testID="pay-upi-btn" style={styles.cta} onPress={payViaUpi}>
                <Ionicons name="wallet" size={18} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "700" }}>Pay {inr(c.due)} via UPI</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.sect}>Payment History</Text>
          {data.installments.length === 0 ? (
            <Text style={{ color: COLORS.muted, marginTop: SPACING.sm }}>No payments yet.</Text>
          ) : data.installments.map((i: any) => (
            <View key={i.id} style={styles.instRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.instAmt}>{inr(i.amount)} • {i.method}</Text>
                <Text style={{ color: COLORS.muted, fontSize: 12 }}>{new Date(i.date).toLocaleDateString()}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Attendance</Text>
          <Text style={{ color: COLORS.onSurface, fontWeight: "700", marginTop: SPACING.sm }}>{data.attendance_pct}% attendance</Text>
          <Text style={{ color: COLORS.muted, fontSize: 12 }}>Last {data.attendance.length} sessions</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: SPACING.md }}>
            {data.attendance.slice(0, 30).map((a: any) => (
              <View key={a.date} style={[styles.attDot, { backgroundColor: a.status === "present" ? COLORS.success : a.status === "late" ? COLORS.warning : COLORS.error }]}>
                <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{new Date(a.date).getDate()}</Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, color }: any) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: COLORS.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: color || COLORS.onSurface, fontWeight: "800", fontSize: 15, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  sect: { fontSize: 14, fontWeight: "800", color: COLORS.onSurfaceSecondary },
  progress: { height: 8, backgroundColor: COLORS.divider, borderRadius: 999, overflow: "hidden", marginTop: SPACING.md },
  progressFill: { height: 8, backgroundColor: COLORS.brand },
  pct: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  kv: { marginTop: SPACING.sm, color: COLORS.onSurface },
  k: { color: COLORS.muted, fontSize: 13 },
  cta: { flexDirection: "row", gap: SPACING.sm, backgroundColor: COLORS.brand, paddingVertical: 12, paddingHorizontal: SPACING.xl, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", marginTop: SPACING.md },
  instRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.divider, marginTop: SPACING.sm },
  instAmt: { color: COLORS.onSurface, fontWeight: "700" },
  attDot: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
