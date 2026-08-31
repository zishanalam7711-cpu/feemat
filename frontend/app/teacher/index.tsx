import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, SHADOW, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";

type Dash = {
  teacher: any;
  stats: {
    total_students: number;
    total_fee: number;
    total_paid: number;
    total_due: number;
    total_advance: number;
    pending_requests: number;
  };
};

export default function TeacherDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<Dash | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await api<Dash>("/teacher/dashboard");
      setData(d);
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (loading) {
    return (
      <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
    );
  }

  const t = data?.teacher || {};
  const s = data?.stats;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}
      contentContainerStyle={{ paddingBottom: SPACING.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <LinearGradient
        colors={["#7C3AED", "#A855F7", "#EC4899"]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.hero, { paddingTop: insets.top + SPACING.lg }]}
      >
        <View style={styles.headerRow}>
          <Avatar name={t.name} uri={t.photo_url} size={48} bg="rgba(255,255,255,0.2)" fg="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Welcome back,</Text>
            <Text style={styles.name} testID="teacher-name">{t.name || "Teacher"}</Text>
            <Text style={styles.tid} testID="teacher-id">{t.teacher_id}</Text>
          </View>
        </View>

        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>Total Due</Text>
          <Text style={styles.heroValue} testID="stat-total-due">{inr(s?.total_due)}</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroCol}>
              <Text style={styles.heroSub}>Collected</Text>
              <Text style={styles.heroSubV}>{inr(s?.total_paid)}</Text>
            </View>
            <View style={styles.heroCol}>
              <Text style={styles.heroSub}>Total Fee</Text>
              <Text style={styles.heroSubV}>{inr(s?.total_fee)}</Text>
            </View>
            <View style={styles.heroCol}>
              <Text style={styles.heroSub}>Advance</Text>
              <Text style={styles.heroSubV}>{inr(s?.total_advance)}</Text>
            </View>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.grid}>
        <StatCard testID="stat-students" title="Students" value={String(s?.total_students ?? 0)} icon="people" color={COLORS.brand} />
        <StatCard testID="stat-requests" title="Requests" value={String(s?.pending_requests ?? 0)} icon="mail-unread" color="#EC4899" onPress={() => router.push("/teacher/requests")} />
      </View>

      <Text style={styles.sect}>Quick Actions</Text>
      <View style={styles.quickWrap}>
        <QuickBtn label="Students" icon="people" onPress={() => router.push("/teacher/students")} />
        <QuickBtn label="Requests" icon="mail-unread" onPress={() => router.push("/teacher/requests")} />
        <QuickBtn label="Profile" icon="person-circle" onPress={() => router.push("/teacher/profile")} />
      </View>
    </ScrollView>
  );
}

function StatCard({ title, value, icon, color, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.statCard, SHADOW.card]}>
      <View style={[styles.statIcon, { backgroundColor: color + "22" }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <View>
        <Text style={styles.statLabel}>{title}</Text>
        <Text style={styles.statValue}>{value}</Text>
      </View>
    </Pressable>
  );
}

function QuickBtn({ label, icon, onPress }: any) {
  return (
    <Pressable onPress={onPress} style={styles.quickBtn}>
      <View style={styles.quickIcon}>
        <Ionicons name={icon} size={22} color={COLORS.brand} />
      </View>
      <Text style={styles.quickLbl}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surface },
  hero: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xxl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  hello: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  name: { color: "#fff", fontSize: 22, fontWeight: "800" },
  tid: { color: "rgba(255,255,255,0.9)", fontSize: 12, fontWeight: "600", marginTop: 2 },
  heroCard: { marginTop: SPACING.xl, padding: SPACING.lg, borderRadius: RADIUS.lg, backgroundColor: "rgba(255,255,255,0.16)" },
  heroLabel: { color: "rgba(255,255,255,0.9)", fontSize: 13 },
  heroValue: { color: "#fff", fontSize: 34, fontWeight: "800", marginTop: 4 },
  heroRow: { flexDirection: "row", marginTop: SPACING.lg, gap: SPACING.md },
  heroCol: { flex: 1 },
  heroSub: { color: "rgba(255,255,255,0.85)", fontSize: 11 },
  heroSubV: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", padding: SPACING.lg, gap: SPACING.md },
  statCard: { width: "48%", flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.lg, borderRadius: RADIUS.md, backgroundColor: COLORS.surface },
  statIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statLabel: { color: COLORS.muted, fontSize: 12 },
  statValue: { fontSize: 20, fontWeight: "800", color: COLORS.onSurface },
  sect: { fontSize: 14, fontWeight: "700", color: COLORS.onSurfaceSecondary, marginTop: SPACING.md, paddingHorizontal: SPACING.xl },
  quickWrap: { flexDirection: "row", gap: SPACING.md, padding: SPACING.lg },
  quickBtn: { flex: 1, alignItems: "center", backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, ...SHADOW.card },
  quickIcon: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.brandSoft },
  quickLbl: { marginTop: 6, fontSize: 12, color: COLORS.onSurface, fontWeight: "600" },
});
