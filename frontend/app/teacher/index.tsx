import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert, Share } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GRAD, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";
import { GradientBg, Logo, StatusPill } from "@/src/components/ui";

type Opt = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  route?: string;
  soon?: string;
  badge?: "requests" | "claims";
};

// All tools of the teacher portal (nothing is lost in the new design)
const OPTIONS: Opt[] = [
  { label: "Students", icon: "people", color: "#1F6BFF", route: "/teacher/students" },
  { label: "Classes", icon: "school", color: "#F59E0B", route: "/teacher/classes" },
  { label: "Add Student", icon: "person-add", color: "#2E8BFF", route: "/teacher/add-student" },
  { label: "Collect", icon: "cash", color: "#16A34A", route: "/teacher/collect" },
  { label: "Attendance", icon: "checkmark-done-circle", color: "#14B8A6", route: "/teacher/attendance" },
  { label: "Homework", icon: "clipboard", color: "#60A5FA", route: "/teacher/homework" },
  { label: "Exams", icon: "document-text", color: "#10B981", route: "/teacher/exams" },
  { label: "Results", icon: "trophy", color: "#FBBF24", route: "/teacher/exams" },
  { label: "Reports", icon: "bar-chart", color: "#EC4899", route: "/teacher/reports" },
  { label: "Announce", icon: "megaphone", color: "#4F8DFF", route: "/teacher/announcements" },
  { label: "Alerts", icon: "notifications", color: "#F97316", route: "/teacher/notifications" },
  { label: "Timetable", icon: "calendar", color: "#38BDF8", route: "/teacher/timetable" },
  { label: "UPI Pay", icon: "qr-code", color: "#34D399", route: "/teacher/upi", badge: "claims" },
  { label: "Requests", icon: "mail-unread", color: "#F472B6", route: "/teacher/requests", badge: "requests" },
  { label: "Pro Plan", icon: "rocket", color: "#06B6D4", route: "/teacher/subscription" },
  { label: "AI Assistant", icon: "sparkles", color: "#6366F1", route: "/teacher/ai" },
  { label: "AI Attendance", icon: "camera", color: "#14B8A6", route: "/teacher/ai-attendance" },
  { label: "Profile", icon: "person-circle", color: "#6366F1", route: "/teacher/profile" },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
}

export default function TeacherDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState(0);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    try { setData(await api("/teacher/dashboard")); } catch {}
    try { const r: any = await api("/teacher/students?filter=all&limit=5"); setRecent(r?.items || []); } catch {}
    try { const c: any = await api("/teacher/payment-claims/count"); setClaims(c?.pending || 0); } catch {}
    try { const n: any = await api("/notifications"); setUnread((n || []).filter((x: any) => !x.read).length); } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  if (loading) return <GradientBg style={{ alignItems: "center", justifyContent: "center" }}><ActivityIndicator color="#35C8FF" /></GradientBg>;

  const t = data?.teacher || {};
  const s = data?.stats;
  const plan = data?.plan;
  const isPro = plan?.plan === "pro";
  const first = String(t.name || "Teacher").split(" ")[0];

  const open = (o: Opt) => {
    if (o.route) router.push(o.route as any);
    else Alert.alert("Coming Soon", o.soon || "This feature is coming soon.");
  };
  const shareInvite = () =>
    Share.share({
      message: `Join my class on FeeMat! Open the FeeMat app, choose Student Portal and search for my Teacher ID: ${t.teacher_id}${t.coaching_name ? ` (${t.coaching_name})` : ""}.`,
    });

  const quick: { label: string; icon: any; onPress: () => void; badge?: number; color: string }[] = [
    { label: "Add Student", icon: "person-add", color: "#1F6BFF", onPress: () => router.push("/teacher/add-student" as any) },
    { label: "QR / UPI", icon: "qr-code", color: "#1F6BFF", onPress: () => router.push("/teacher/upi" as any), badge: claims },
    { label: "WhatsApp Share", icon: "logo-whatsapp", color: "#16A34A", onPress: shareInvite },
    { label: "Notifications", icon: "notifications", color: "#1F6BFF", onPress: () => router.push("/teacher/notifications" as any), badge: unread },
  ];

  return (
    <GradientBg>
      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.push("/teacher/profile" as any)} hitSlop={10}>
          <Ionicons name="menu" size={28} color="#fff" />
        </Pressable>
        <Logo size={46} tagline={false} />
        <Pressable onPress={() => router.push("/teacher/notifications" as any)} hitSlop={10} testID="notif-bell">
          <Ionicons name="notifications" size={26} color="#fff" />
          {unread > 0 ? <View style={styles.bellDot}><Text style={styles.bellTxt}>{unread > 9 ? "9+" : unread}</Text></View> : null}
        </Pressable>
      </View>

      <ScrollView
        style={styles.panel}
        contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1F6BFF" />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.greetRow}>
          <Avatar name={t.name} uri={t.photo_url} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={styles.role}>Teacher</Text>
            <Text style={styles.greet} testID="teacher-name">{greeting()}, {first}</Text>
            <Text style={styles.greetSub}>Manage your students & fees</Text>
            <Text style={styles.tid} testID="teacher-id">{t.teacher_id}{t.coaching_name ? `  •  ${t.coaching_name}` : ""}</Text>
          </View>
          <View style={[styles.plan, isPro && { backgroundColor: "#FEF3C7" }]}>
            <Ionicons name={isPro ? "star" : "flash"} size={12} color={isPro ? "#D97706" : "#1F6BFF"} />
            <Text style={[styles.planTxt, isPro && { color: "#D97706" }]}>{isPro ? "PRO" : "FREE"}</Text>
          </View>
        </View>

        {!isPro && s ? (
          <Pressable onPress={() => router.push("/teacher/subscription" as any)} style={styles.upgrade} testID="upgrade-banner">
            <Ionicons name="rocket" size={18} color="#1F6BFF" />
            <Text style={styles.upgradeTxt}>{s.active_students}/{s.free_limit} free students used. Upgrade to Pro for unlimited.</Text>
            <Ionicons name="chevron-forward" size={18} color="#1F6BFF" />
          </Pressable>
        ) : null}

        <Pressable onPress={() => router.push("/teacher/ai" as any)} testID="ai-card" style={{ marginTop: 14 }}>
          <LinearGradient colors={["#0B2F78", "#1F6BFF", "#16B5F0"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.aiCard}>
            <View style={styles.aiIcon}><Ionicons name="sparkles" size={26} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.aiTitle}>AI Assistant</Text>
              <Text style={styles.aiSub}>Ask about fees and students, upload photos or PDFs, make worksheets, take attendance from a class photo.</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#fff" />
          </LinearGradient>
        </Pressable>

        <View style={styles.grid}>
          <Pressable style={{ flex: 1 }} onPress={() => router.push("/teacher/students" as any)} testID="stat-students">
            <LinearGradient colors={GRAD.blue} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.statBig}>
              <Text style={styles.statBigLbl}>Total Students</Text>
              <View style={styles.statBigRow}>
                <Text style={styles.statBigVal}>{s?.active_students ?? 0}</Text>
                <View style={styles.statArrow}><Ionicons name="arrow-forward" size={16} color="#1F6BFF" /></View>
              </View>
            </LinearGradient>
          </Pressable>
          <Pressable style={{ flex: 1 }} onPress={() => router.push("/teacher/reports" as any)}>
            <LinearGradient colors={GRAD.blue} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.statBig}>
              <Text style={styles.statBigLbl}>Total Fees</Text>
              <View style={styles.statBigRow}>
                <Text style={styles.statBigVal} numberOfLines={1} adjustsFontSizeToFit>{inr(s?.total_fee)}</Text>
                <View style={styles.statArrow}><Ionicons name="arrow-forward" size={16} color="#1F6BFF" /></View>
              </View>
            </LinearGradient>
          </Pressable>
        </View>

        <View style={styles.grid}>
          <View style={[styles.statSoft, { backgroundColor: "#DCFCE7" }]} testID="stat-paid">
            <View style={[styles.softIcon, { backgroundColor: "#16A34A" }]}><Ionicons name="checkmark" size={16} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.softLbl}>Paid</Text>
              <Text style={[styles.softVal, { color: "#15803D" }]} numberOfLines={1} adjustsFontSizeToFit>{inr(s?.total_paid)}</Text>
            </View>
          </View>
          <Pressable style={[styles.statSoft, { backgroundColor: "#FEE2E2" }]} onPress={() => router.push("/teacher/collect" as any)} testID="stat-total-due">
            <View style={[styles.softIcon, { backgroundColor: "#EF4444" }]}><Ionicons name="time" size={16} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.softLbl}>Due</Text>
              <Text style={[styles.softVal, { color: "#DC2626" }]} numberOfLines={1} adjustsFontSizeToFit>{inr(s?.total_due)}</Text>
            </View>
          </Pressable>
        </View>

        <View style={styles.quickRow}>
          {quick.map((q) => (
            <Pressable key={q.label} onPress={q.onPress} style={styles.quick}>
              <View style={[styles.quickIcon, { backgroundColor: q.color + "1A" }]}>
                <Ionicons name={q.icon} size={24} color={q.color} />
                {q.badge && q.badge > 0 ? <View style={styles.badge}><Text style={styles.badgeTxt}>{q.badge}</Text></View> : null}
              </View>
              <Text style={styles.quickLbl} numberOfLines={2}>{q.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.secRow}>
          <Text style={styles.sec}>Recent Students</Text>
          <Pressable onPress={() => router.push("/teacher/students" as any)}><Text style={styles.viewAll}>View All</Text></Pressable>
        </View>
        {recent.length === 0 ? (
          <Text style={styles.empty}>No students yet. Tap "Add Student" to add your first one.</Text>
        ) : recent.map((c) => (
          <Pressable key={c.id} style={styles.studentRow} onPress={() => router.push(`/teacher/student/${c.id}` as any)}>
            <Avatar name={c.student?.name} uri={c.student?.photo_url} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={styles.sName} numberOfLines={1}>{c.student?.name || "Student"}</Text>
              <Text style={styles.sMeta}>ID: {c.admission_number}</Text>
            </View>
            <StatusPill paid={!(c.due > 0)} />
          </Pressable>
        ))}

        <Text style={[styles.sec, { marginTop: 22 }]}>All Tools</Text>
        <View style={styles.tools}>
          {OPTIONS.map((o) => {
            const n = o.badge === "requests" ? (s?.pending_requests ?? 0) : o.badge === "claims" ? claims : 0;
            return (
              <Pressable key={o.label} style={styles.toolCell} onPress={() => open(o)}>
                <View style={styles.tool}>
                  <View style={[styles.toolIcon, { backgroundColor: o.color + "22" }]}>
                    <Ionicons name={o.icon} size={20} color={o.color} />
                    {n > 0 ? <View style={styles.badge}><Text style={styles.badgeTxt}>{n}</Text></View> : null}
                  </View>
                  <Text style={styles.toolLbl} numberOfLines={1}>{o.label}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </GradientBg>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 },
  bellDot: { position: "absolute", top: -6, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#22C55E", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  bellTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  panel: { flex: 1, backgroundColor: "#F4F8FF", borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  greetRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  role: { color: "#1F6BFF", fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  greet: { color: "#0F172A", fontSize: 18, fontWeight: "800", marginTop: 1 },
  greetSub: { color: "#64748B", fontSize: 12, marginTop: 1 },
  tid: { color: "#94A3B8", fontSize: 11, marginTop: 2 },
  plan: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: "#DBEAFE" },
  planTxt: { color: "#1F6BFF", fontWeight: "800", fontSize: 11 },
  upgrade: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: "#DBEAFE" },
  upgradeTxt: { flex: 1, color: "#1E3A8A", fontSize: 12, fontWeight: "600" },
  aiCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, padding: 16 },
  aiIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  aiTitle: { color: "#fff", fontSize: 17, fontWeight: "800" },
  aiSub: { color: "rgba(255,255,255,0.9)", fontSize: 12, lineHeight: 17, marginTop: 2 },
  grid: { flexDirection: "row", gap: 12, marginTop: 14 },
  statBig: { borderRadius: 18, padding: 16, height: 104, justifyContent: "space-between" },
  statBigLbl: { color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "600" },
  statBigRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  statBigVal: { color: "#fff", fontSize: 26, fontWeight: "800", flexShrink: 1 },
  statArrow: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  statSoft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 14, height: 76 },
  softIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  softLbl: { color: "#475569", fontSize: 12, fontWeight: "600" },
  softVal: { fontSize: 20, fontWeight: "800" },
  quickRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  quick: { flex: 1, alignItems: "center", backgroundColor: "#fff", borderRadius: 16, paddingVertical: 12, paddingHorizontal: 4, gap: 8, shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  quickIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  quickLbl: { color: "#0F172A", fontSize: 11, fontWeight: "700", textAlign: "center", minHeight: 28 },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  secRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 6 },
  sec: { color: "#0F172A", fontSize: 17, fontWeight: "800" },
  viewAll: { color: "#1F6BFF", fontWeight: "700", fontSize: 13 },
  empty: { color: "#64748B", marginTop: 10, fontSize: 13 },
  studentRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 12, marginTop: 8 },
  sName: { color: "#0F172A", fontWeight: "700", fontSize: 14 },
  sMeta: { color: "#94A3B8", fontSize: 11, marginTop: 2 },
  tools: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4, marginTop: 8 },
  toolCell: { width: "25%", padding: 4 },
  tool: { alignItems: "center", backgroundColor: "#fff", paddingVertical: 12, paddingHorizontal: 2, borderRadius: 14, gap: 6 },
  toolIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  toolLbl: { color: "#0F172A", fontSize: 11, fontWeight: "600" },
});
