import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS, SHADOW, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";

const DARK = {
  bg: "#120A28",
  card: "#1E1440",
  cardBorder: "rgba(255,255,255,0.08)",
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.6)",
  muted: "rgba(255,255,255,0.45)",
};

const QUICK_COLORS: Record<string, string> = {
  Students: "#A855F7",
  Classes: "#F59E0B",
  Homework: "#3B82F6",
  Exams: "#10B981",
  Reports: "#EC4899",
  Announce: "#8B5CF6",
  Pricing: "#06B6D4",
  Profile: "#38BDF8",
};

export default function TeacherDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { try { setData(await api("/teacher/dashboard")); } catch {} }, []);
  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#A855F7" /></View>;
  const t = data?.teacher || {};
  const s = data?.stats;
  const plan = data?.plan;
  const isPro = plan?.plan === "pro";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: DARK.bg }}
      contentContainerStyle={{ paddingBottom: SPACING.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A855F7" />}
    >
      <LinearGradient colors={["#5B21B6", "#7C3AED", "#DB2777"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + SPACING.lg }]}>
        <View style={styles.headerRow}>
          <View>
            <Avatar name={t.name} uri={t.photo_url} size={48} bg="rgba(255,255,255,0.2)" fg="#fff" />
            {isPro && (
              <View style={styles.crownBadge}>
                <Ionicons name="trophy" size={10} color="#120A28" />
              </View>
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>Welcome back,</Text>
            <Text style={styles.name} testID="teacher-name">{t.name || "Teacher"}</Text>
            <Text style={styles.tid} testID="teacher-id">{t.teacher_id} • {t.coaching_name || "Independent"}</Text>
          </View>
          <View style={[styles.planPill, isPro && styles.proPill]}>
            <Ionicons name={isPro ? "star" : "flash"} size={12} color={isPro ? "#F59E0B" : "#fff"} />
            <Text style={[styles.planTxt, isPro && { color: "#F59E0B" }]}>{isPro ? "PRO" : "FREE"}</Text>
          </View>
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroCardTop}>
            <View>
              <Text style={styles.heroLabel}>Total Due</Text>
              <Text style={styles.heroValue} testID="stat-total-due">{inr(s?.total_due)}</Text>
            </View>
            <View style={styles.walletIcon}>
              <Ionicons name="wallet" size={26} color="#fff" />
            </View>
          </View>
          <View style={styles.heroRow}>
            <HeroStat label="This Month" value={inr(s?.this_month_collection)} />
            <HeroStat label="Collected" value={inr(s?.total_paid)} />
            <HeroStat label="Advance" value={inr(s?.total_advance)} />
          </View>
        </View>
      </LinearGradient>

      {!isPro && (
        <Pressable testID="upgrade-banner" onPress={() => router.push("/teacher/subscription")} style={styles.upgradeBanner}>
          <Ionicons name="rocket" size={20} color="#A855F7" />
          <View style={{ flex: 1 }}>
            <Text style={styles.upgradeTitle}>{s?.active_students}/{s?.free_limit} Free students used</Text>
            <Text style={styles.upgradeSub}>Upgrade to Pro for unlimited students, receipts & reports.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#A855F7" />
        </Pressable>
      )}

      <View style={styles.grid}>
        <StatCard testID="stat-students" title="Active" value={String(s?.active_students ?? 0)} icon="people" color="#A855F7" onPress={() => router.push("/teacher/students")} />
        <StatCard testID="stat-requests" title="Requests" value={String(s?.pending_requests ?? 0)} icon="mail-unread" color="#EC4899" onPress={() => router.push("/teacher/requests")} />
        <StatCard title="Today Att." value={String(s?.today_attendance ?? 0)} icon="checkmark-done" color="#10B981" />
        <StatCard title="Total Fee" value={inr(s?.total_fee)} icon="wallet" color="#3B82F6" />
      </View>

      <View style={styles.sectRow}>
        <Text style={styles.sect}>Quick Actions</Text>
      </View>
      <View style={styles.quickWrap}>
        <QuickBtn label="Students" icon="people" onPress={() => router.push("/teacher/students")} />
        <QuickBtn label="Classes" icon="school" onPress={() => router.push("/teacher/classes")} />
        <QuickBtn label="Homework" icon="clipboard" onPress={() => router.push("/teacher/homework")} />
        <QuickBtn label="Exams" icon="document-text" onPress={() => router.push("/teacher/exams")} />
      </View>
      <View style={styles.quickWrap}>
        <QuickBtn label="Reports" icon="bar-chart" onPress={() => router.push("/teacher/reports")} />
        <QuickBtn label="Announce" icon="megaphone" onPress={() => router.push("/teacher/announcements")} />
        <QuickBtn label="Pricing" icon="rocket" onPress={() => router.push("/teacher/subscription")} />
        <QuickBtn label="Profile" icon="person-circle" onPress={() => router.push("/teacher/profile")} />
      </View>
    </ScrollView>
  );
}

function HeroStat({ label, value }: any) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.heroSub}>{label}</Text>
      <Text style={styles.heroSubV}>{value}</Text>
    </View>
  );
}
function StatCard({ title, value, icon, color, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.statCard, SHADOW.card]}>
      <View style={[styles.statIcon, { backgroundColor: color + "26" }]}>
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
  const color = QUICK_COLORS[label] || "#A855F7";
  return (
    <Pressable onPress={onPress} style={styles.quickBtn}>
      <View style={[styles.quickIcon, { backgroundColor: color + "26" }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.quickLbl}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: DARK.bg },
  hero: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.xxl, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  crownBadge: {
    position: "absolute", top: -6, right: -2, width: 18, height: 18, borderRadius: 9,
    backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#7C3AED",
  },
  hello: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  name: { color: "#fff", fontSize: 20, fontWeight: "800" },
  tid: { color: "rgba(255,255,255,0.9)", fontSize: 11, fontWeight: "600", marginTop: 2 },
  planPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.18)" },
  proPill: { backgroundColor: "#FEF3C7" },
  planTxt: { color: "#fff", fontWeight: "800", fontSize: 11 },
  heroCard: { marginTop: SPACING.xl, padding: SPACING.lg, borderRadius: RADIUS.lg, backgroundColor: "rgba(255,255,255,0.14)" },
  heroCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  walletIcon: {
    width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  heroLabel: { color: "rgba(255,255,255,0.9)", fontSize: 13 },
  heroValue: { color: "#fff", fontSize: 34, fontWeight: "800", marginTop: 4 },
  heroRow: { flexDirection: "row", marginTop: SPACING.lg, gap: SPACING.md },
  heroSub: { color: "rgba(255,255,255,0.85)", fontSize: 11 },
  heroSubV: { color: "#fff", fontSize: 15, fontWeight: "700", marginTop: 2 },
  upgradeBanner: { flexDirection: "row", alignItems: "center", gap: SPACING.md, margin: SPACING.md, padding: SPACING.md, backgroundColor: "rgba(168,85,247,0.12)", borderRadius: RADIUS.md, borderWidth: 1, borderColor: "rgba(168,85,247,0.3)" },
  upgradeTitle: { color: "#C4B5FD", fontWeight: "800", fontSize: 13 },
  upgradeSub: { color: DARK.textSecondary, fontSize: 12, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: SPACING.md, gap: SPACING.md },
  statCard: { width: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.cardBorder },
  statIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statLabel: { color: DARK.muted, fontSize: 12 },
  statValue: { fontSize: 17, fontWeight: "800", color: DARK.textPrimary },
  sectRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: SPACING.xl, marginTop: SPACING.md },
  sect: { fontSize: 14, fontWeight: "800", color: DARK.textSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  quickWrap: { flexDirection: "row", gap: SPACING.sm, paddingHorizontal: SPACING.md, marginTop: SPACING.md },
  quickBtn: { flex: 1, alignItems: "center", backgroundColor: DARK.card, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: DARK.cardBorder },
  quickIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  quickLbl: { marginTop: 6, fontSize: 11, color: DARK.textPrimary, fontWeight: "600" },
});
