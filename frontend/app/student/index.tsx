import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, SHADOW, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";

export default function StudentHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => { try { setData(await api("/student/home")); } catch {} }, []);
  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;
  const s = data?.student || {};
  const t = data?.teacher;
  const c = data?.connection;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
    >
      <LinearGradient colors={["#7C3AED", "#EC4899"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + SPACING.lg }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
          <Avatar name={s.name} uri={s.photo_url} size={52} bg="rgba(255,255,255,0.22)" fg="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Hello,</Text>
            <Text style={styles.name} testID="student-name">{s.name || "Student"}</Text>
            {c ? <Text style={styles.tid} testID="admission-number">Adm: {c.admission_number}</Text> : <Text style={styles.tid}>Not connected yet</Text>}
          </View>
          <Pressable onPress={() => router.push("/student/notifications")} testID="notif-bell" style={{ position: "relative" }}>
            <Ionicons name="notifications" size={26} color="#fff" />
            {data.unread > 0 && <View style={styles.badge}><Text style={styles.badgeTxt}>{data.unread}</Text></View>}
          </Pressable>
        </View>
      </LinearGradient>

      {!t ? (
        <View style={styles.emptyCard}>
          <Ionicons name="school-outline" size={56} color={COLORS.brand} />
          <Text style={styles.emptyTitle}>Find your teacher</Text>
          <Text style={styles.emptySub}>Search by Teacher ID to send a join request. Your admission number will be generated automatically when accepted.</Text>
          <Pressable testID="cta-search-teacher" style={styles.cta} onPress={() => router.push("/student/search")}>
            <Ionicons name="search" size={18} color="#fff" />
            <Text style={{ color: "#fff", fontWeight: "700" }}>Search Teacher</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Pressable style={[styles.card, SHADOW.card]} onPress={() => router.push(`/student/teacher/${t.teacher_id}`)} testID="my-teacher-card">
            <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
              <Avatar name={t.name} uri={t.photo_url} size={52} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tName}>{t.name}</Text>
                <Text style={styles.tMeta}>{t.teacher_id} • {t.coaching_name || "—"}</Text>
                <Text style={styles.tMeta}>{(t.subjects || []).slice(0, 3).join(", ")}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
            </View>
          </Pressable>

          {c && (
            <View style={[styles.card, SHADOW.card]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={styles.sect}>Fee Summary</Text>
                <Text style={styles.pill}>Monthly {inr(c.monthly_fee)}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
                <Stat label="Billed" value={inr(c.total_billed)} />
                <Stat label="Paid" value={inr(c.paid_all)} color={COLORS.success} />
                <Stat label="Due" value={inr(c.due_all)} color={c.due_all > 0 ? COLORS.error : COLORS.success} />
                <Stat label="Adv" value={inr(c.advance)} />
              </View>
              <Pressable style={[styles.cta, { marginTop: SPACING.lg }]} onPress={() => router.push({ pathname: "/student/fee", params: { id: c.id } })} testID="view-fee-details">
                <Text style={{ color: "#fff", fontWeight: "700" }}>Fee, Payments & Attendance</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.quickRow}>
            <QuickBtn label="Homework" icon="clipboard" onPress={() => router.push("/student/homework")} />
            <QuickBtn label="Results" icon="ribbon" onPress={() => router.push("/student/results")} />
            <QuickBtn label="Attendance" icon="calendar" onPress={() => c ? router.push({ pathname: "/student/fee", params: { id: c.id } }) : null} />
            <QuickBtn label="Teacher" icon="person" onPress={() => router.push(`/student/teacher/${t.teacher_id}`)} />
          </View>
        </>
      )}
    </ScrollView>
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
function QuickBtn({ label, icon, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={styles.qbtn}>
      <View style={styles.qIcn}><Ionicons name={icon} size={20} color={COLORS.brand} /></View>
      <Text style={styles.qLbl}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  hero: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xxl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  hello: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  name: { color: "#fff", fontSize: 22, fontWeight: "800" },
  tid: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontWeight: "600", marginTop: 2 },
  badge: { position: "absolute", top: -2, right: -6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center" },
  badgeTxt: { color: "#fff", fontSize: 9, fontWeight: "800" },
  emptyCard: { margin: SPACING.lg, padding: SPACING.xl, alignItems: "center", gap: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: COLORS.onSurface },
  emptySub: { color: COLORS.muted, textAlign: "center", lineHeight: 20 },
  cta: { flexDirection: "row", gap: SPACING.sm, backgroundColor: COLORS.brand, paddingVertical: 14, paddingHorizontal: SPACING.xl, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  card: { margin: SPACING.lg, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md },
  tName: { fontSize: 16, fontWeight: "800", color: COLORS.onSurface },
  tMeta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  sect: { fontSize: 14, fontWeight: "800", color: COLORS.onSurfaceSecondary },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: COLORS.brandSoft, color: COLORS.brand, fontWeight: "700", fontSize: 12 },
  quickRow: { flexDirection: "row", gap: SPACING.sm, paddingHorizontal: SPACING.lg, marginTop: SPACING.md, marginBottom: SPACING.xxl },
  qbtn: { flex: 1, alignItems: "center", padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  qIcn: { width: 40, height: 40, borderRadius: 12, backgroundColor: COLORS.brandSoft, alignItems: "center", justifyContent: "center" },
  qLbl: { fontSize: 11, fontWeight: "700", color: COLORS.onSurface, marginTop: 6 },
});
