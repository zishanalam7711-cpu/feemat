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
  const [tab, setTab] = useState<"months" | "history" | "attendance">("months");

  const load = useCallback(async () => { setLoading(true); try { setData(await api(`/connections/${id}`)); } catch {} setLoading(false); }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;

  const c = data.connection;
  const t = data.teacher;
  const pct = c.total_billed > 0 ? Math.min(100, Math.round((c.paid_all / c.total_billed) * 100)) : 0;

  const payViaUpi = () => {
    if (!t.upi_id) return;
    const url = `upi://pay?pa=${t.upi_id}&pn=${encodeURIComponent(t.name)}&am=${c.due_all}&cu=INR&tn=${encodeURIComponent(c.admission_number)}`;
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
            <Stat label="Billed" value={inr(c.total_billed)} />
            <Stat label="Paid" value={inr(c.paid_all)} color={COLORS.success} />
            <Stat label="Due" value={inr(c.due_all)} color={c.due_all > 0 ? COLORS.error : COLORS.success} />
            <Stat label="Adv" value={inr(c.advance)} />
          </View>
          <View style={styles.progress}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
          <Text style={styles.pct}>{pct}% collected</Text>
        </View>

        {(t.upi_id || t.qr_url) && c.due_all > 0 && (
          <View style={styles.card}>
            <Text style={styles.sect}>Pay Your Teacher</Text>
            {t.upi_id ? <Text style={styles.kv}><Text style={styles.k}>UPI: </Text>{t.upi_id}</Text> : null}
            {t.qr_url ? <Image source={{ uri: t.qr_url }} style={{ width: 200, height: 200, alignSelf: "center", marginTop: SPACING.md, borderRadius: 12 }} /> : null}
            {t.upi_id && c.due_all > 0 ? (
              <Pressable testID="pay-upi-btn" style={styles.cta} onPress={payViaUpi}>
                <Ionicons name="wallet" size={18} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "700" }}>Pay {inr(c.due_all)} via UPI</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        <View style={styles.tabs}>
          {(["months", "history", "attendance"] as const).map((tK) => (
            <Pressable key={tK} testID={`tab-${tK}`} onPress={() => setTab(tK)} style={[styles.tab, tab === tK && styles.tabOn]}>
              <Text style={[styles.tabTxt, tab === tK && styles.tabTxtOn]}>{tK === "months" ? "Monthly" : tK === "history" ? "Receipts" : "Attendance"}</Text>
            </Pressable>
          ))}
        </View>

        {tab === "months" && (
          <View style={styles.card}>
            {data.fee_months.length === 0 ? (
              <Text style={{ color: COLORS.muted }}>No monthly fees yet. Teacher will set your monthly fee.</Text>
            ) : data.fee_months.slice().reverse().map((fm: any) => (
              <View key={fm.id} style={styles.monthRow}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={styles.monthLbl}>{fm.month}</Text>
                    <StatusChip status={fm.status} />
                  </View>
                  <Text style={styles.meta}>{inr(fm.original_fee)}{fm.discount > 0 ? ` − ${inr(fm.discount)}` : ""}{fm.fine > 0 ? ` + ${inr(fm.fine)} fine` : ""}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={fm.due > 0 ? { color: COLORS.error, fontWeight: "800" } : { color: COLORS.success, fontWeight: "800" }}>{fm.due > 0 ? inr(fm.due) : "Paid"}</Text>
                  <Text style={styles.meta}>Paid {inr(fm.paid)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {tab === "history" && (
          <View style={styles.card}>
            {data.installments.length === 0 ? (
              <Text style={{ color: COLORS.muted }}>No payments yet.</Text>
            ) : data.installments.map((i: any) => (
              <Pressable key={i.id} style={styles.monthRow} onPress={() => router.push(`/student/receipt/${i.receipt_number}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.instAmt}>{inr(i.amount)} • {i.method}</Text>
                  <Text style={styles.meta}>{i.month} • {new Date(i.date).toLocaleDateString()}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ color: COLORS.brand, fontSize: 11, fontWeight: "700" }}>{i.receipt_number}</Text>
                  <Ionicons name="receipt" size={18} color={COLORS.brand} />
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {tab === "attendance" && (
          <View style={styles.card}>
            <Text style={{ color: COLORS.onSurface, fontWeight: "700" }}>{data.attendance_pct}% attendance</Text>
            <Text style={{ color: COLORS.muted, fontSize: 12 }}>Last {data.attendance.length} sessions</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: SPACING.md }}>
              {data.attendance.slice(0, 60).map((a: any) => (
                <View key={a.date} style={[styles.attDot, {
                  backgroundColor: a.status === "present" ? COLORS.success : a.status === "late" ? COLORS.warning : a.status === "leave" ? COLORS.info : COLORS.error
                }]}>
                  <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>{new Date(a.date).getDate()}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
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
function StatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    paid: { bg: "#DCFCE7", fg: "#065F46", label: "PAID" },
    partial: { bg: "#FEF3C7", fg: "#92400E", label: "PARTIAL" },
    due: { bg: "#DBEAFE", fg: "#1E40AF", label: "DUE" },
    overdue: { bg: "#FEE2E2", fg: "#991B1B", label: "OVERDUE" },
    waived: { bg: "#E0E7FF", fg: "#3730A3", label: "WAIVED" },
  };
  const s = map[status] || map.due;
  return <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: s.bg }}><Text style={{ color: s.fg, fontSize: 9, fontWeight: "800" }}>{s.label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  sect: { fontSize: 14, fontWeight: "800", color: COLORS.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  progress: { height: 8, backgroundColor: COLORS.divider, borderRadius: 999, overflow: "hidden", marginTop: SPACING.md },
  progressFill: { height: 8, backgroundColor: COLORS.brand },
  pct: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  kv: { marginTop: SPACING.sm, color: COLORS.onSurface },
  k: { color: COLORS.muted, fontSize: 13 },
  cta: { flexDirection: "row", gap: SPACING.sm, backgroundColor: COLORS.brand, paddingVertical: 12, paddingHorizontal: SPACING.xl, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", marginTop: SPACING.md },
  tabs: { flexDirection: "row", gap: SPACING.sm },
  tab: { flex: 1, paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  tabOn: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  tabTxt: { color: COLORS.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  tabTxtOn: { color: "#fff" },
  monthRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingVertical: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.divider },
  monthLbl: { color: COLORS.onSurface, fontWeight: "800", fontSize: 15 },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  instAmt: { color: COLORS.onSurface, fontWeight: "700" },
  attDot: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
