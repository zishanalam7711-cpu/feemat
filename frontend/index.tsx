import React, { useCallback, useState } from "react";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, RefreshControl, TextInput, Alert } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GRAD, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";
import { GradientBg, Logo, GradBtn } from "@/src/components/ui";

export default function StudentHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    try {
      const h: any = await api("/student/home");
      setData(h);
      if (h?.connection?.id) {
        try { const d: any = await api(`/connections/${h.connection.id}`); setRecent((d?.installments || []).slice(0, 3)); } catch {}
      } else setRecent([]);
    } catch {}
  }, []);
  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));

  const claim = async () => {
    if (!code.trim()) { Alert.alert("Enter the code", "Enter the code your teacher gave you."); return; }
    setClaiming(true);
    try {
      await api("/student/claim", { method: "POST", body: { code: code.trim() } });
      setShowCode(false); setCode("");
      await load();
      Alert.alert("Record linked 🎉", "The fees, attendance and marks your teacher entered are now in your account.");
    } catch (e: any) {
      Alert.alert("Code did not work", e?.message || "The code is incorrect.");
    } finally { setClaiming(false); }
  };

  if (loading) return <GradientBg style={{ alignItems: "center", justifyContent: "center" }}><ActivityIndicator color="#35C8FF" /></GradientBg>;
  const s = data?.student || {};
  const t = data?.teacher;
  const c = data?.connection;
  const first = String(s.name || "Student").split(" ")[0];

  const tiles: { label: string; icon: any; color: string; onPress: () => void; badge?: number }[] = [
    { label: "History", icon: "time", color: "#1F6BFF", onPress: () => router.push("/student/payments" as any) },
    { label: "Notifications", icon: "notifications", color: "#1F6BFF", onPress: () => router.push("/student/notifications" as any), badge: data?.unread || 0 },
    { label: "Profile", icon: "person", color: "#1F6BFF", onPress: () => router.push("/student/profile" as any) },
    { label: "Homework", icon: "clipboard", color: "#16A34A", onPress: () => router.push("/student/homework" as any) },
    { label: "Results", icon: "ribbon", color: "#F59E0B", onPress: () => router.push("/student/results" as any) },
    { label: "Timetable", icon: "calendar-number", color: "#38BDF8", onPress: () => router.push("/student/timetable" as any) },
    { label: "Attendance", icon: "calendar", color: "#14B8A6", onPress: () => (c ? router.push({ pathname: "/student/fee", params: { id: c.id } }) : null) },
    { label: "Fee Details", icon: "wallet", color: "#EC4899", onPress: () => (c ? router.push({ pathname: "/student/fee", params: { id: c.id } }) : null) },
  ];

  return (
    <View style={{ flex: 1 }}>
      <GradientBg>
        <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
          <View style={{ width: 28 }} />
          <Logo size={46} tagline={false} />
          <Pressable onPress={() => router.push("/student/notifications" as any)} hitSlop={10} testID="notif-bell">
            <Ionicons name="notifications" size={26} color="#fff" />
            {data?.unread > 0 ? <View style={styles.bellDot}><Text style={styles.bellTxt}>{data.unread > 9 ? "9+" : data.unread}</Text></View> : null}
          </Pressable>
        </View>

        <ScrollView
          style={styles.panel}
          contentContainerStyle={{ padding: 18, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#1F6BFF" />}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.greetRow}>
            <Avatar name={s.name} uri={s.photo_url} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={styles.role}>Student</Text>
              <Text style={styles.greet} testID="student-name">Welcome Back, {first}</Text>
              <Text style={styles.greetSub}>Your progress matters</Text>
              {c ? <Text style={styles.tid} testID="admission-number">Adm: {c.admission_number}</Text> : <Text style={styles.tid}>Not connected yet</Text>}
            </View>
          </View>

          {!t ? (
            <View style={styles.emptyCard}>
              <Ionicons name="school-outline" size={54} color="#1F6BFF" />
              <Text style={styles.emptyTitle}>Find your teacher</Text>
              <Text style={styles.emptySub}>Search by Teacher ID to send a join request. Your admission number will be generated automatically when accepted.</Text>
              <GradBtn testID="cta-search-teacher" title="Search Teacher" icon="search" onPress={() => router.push("/student/search" as any)} style={{ alignSelf: "stretch", marginTop: 8 }} />
              <Pressable testID="cta-enter-code" onPress={() => setShowCode(true)} style={{ paddingVertical: 10 }}>
                <Text style={styles.link}>Got a code from your teacher? Enter it here</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Pressable style={styles.teacherCard} onPress={() => router.push(`/student/teacher/${t.teacher_id}` as any)} testID="my-teacher-card">
                <Avatar name={t.name} uri={t.photo_url} size={52} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tLbl}>Your Teacher</Text>
                  <Text style={styles.tName}>{t.name}</Text>
                  <Text style={styles.tMeta} numberOfLines={1}>{t.coaching_name || "—"}</Text>
                  <Text style={styles.tMeta}>ID: {t.teacher_id}</Text>
                </View>
                <View style={styles.viewBtn}><Text style={styles.viewTxt}>View Profile</Text></View>
              </Pressable>

              {c ? (
                <>
                  <View style={styles.feeRow}>
                    <View style={[styles.feeCard, { backgroundColor: "#FEE2E2" }]}>
                      <View style={[styles.feeIcon, { backgroundColor: "#EF4444" }]}><Ionicons name="time" size={16} color="#fff" /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.feeLbl}>Fees Due</Text>
                        <Text style={[styles.feeVal, { color: "#DC2626" }]} numberOfLines={1} adjustsFontSizeToFit>{inr(c.due_all)}</Text>
                      </View>
                    </View>
                    <View style={[styles.feeCard, { backgroundColor: "#DBEAFE" }]}>
                      <View style={[styles.feeIcon, { backgroundColor: "#1F6BFF" }]}><Ionicons name="wallet" size={16} color="#fff" /></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.feeLbl}>Total Fees</Text>
                        <Text style={[styles.feeVal, { color: "#1D4ED8" }]} numberOfLines={1} adjustsFontSizeToFit>{inr(c.total_billed)}</Text>
                      </View>
                    </View>
                  </View>

                  <GradBtn
                    testID="pay-fee-btn" title="Pay Fee" icon="card" colors={GRAD.green} height={54}
                    onPress={() => router.push({ pathname: "/student/pay", params: { id: c.id } })}
                    style={{ marginTop: 14 }}
                  />
                </>
              ) : null}
            </>
          )}

          <View style={styles.tiles}>
            {tiles.map((q) => (
              <Pressable key={q.label} style={styles.tileCell} onPress={q.onPress}>
                <View style={styles.tile}>
                  <View style={[styles.tileIcon, { backgroundColor: q.color + "1F" }]}>
                    <Ionicons name={q.icon} size={22} color={q.color} />
                    {q.badge && q.badge > 0 ? <View style={styles.badge}><Text style={styles.badgeTxt}>{q.badge}</Text></View> : null}
                  </View>
                  <Text style={styles.tileLbl} numberOfLines={1}>{q.label}</Text>
                </View>
              </Pressable>
            ))}
          </View>

          <View style={styles.secRow}>
            <Text style={styles.sec}>Recent Activity</Text>
            <Pressable onPress={() => router.push("/student/payments" as any)}><Text style={styles.viewAll}>View All</Text></Pressable>
          </View>
          {recent.length === 0 ? (
            <Text style={styles.empty}>No payments yet.</Text>
          ) : recent.map((i) => (
            <Pressable key={i.id} style={styles.actRow} onPress={() => router.push(`/student/receipt/${i.receipt_number}` as any)}>
              <View style={styles.actIcon}><Ionicons name="checkmark" size={18} color="#fff" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.actTitle}>Fee Paid</Text>
                <Text style={styles.actMeta}>{inr(i.amount)} • {new Date(i.date).toLocaleDateString()}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </Pressable>
          ))}

          {t ? (
            <Pressable onPress={() => setShowCode(true)} style={{ alignItems: "center", paddingTop: 18 }}>
              <Text style={styles.link}>Have a code from another teacher? Enter it here</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </GradientBg>

      <InlineOverlay visible={showCode} onClose={() => setShowCode(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 22 }}>
          <View style={{ backgroundColor: "#fff", borderRadius: 18, padding: 22, gap: 12 }}>
            <Text style={{ fontSize: 18, fontWeight: "800", color: "#0F172A" }}>Teacher code</Text>
            <Text style={{ color: "#64748B", lineHeight: 19 }}>If your teacher already created your record, enter the code they gave you here. Your fees, attendance and marks will appear in your account.</Text>
            <TextInput
              testID="claim-code-input" value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false}
              placeholder="K7M2P9QX" placeholderTextColor="#94A3B8"
              style={{ height: 50, borderRadius: 12, borderWidth: 1, borderColor: "#DCE6F7", paddingHorizontal: 14, fontSize: 18, letterSpacing: 3, color: "#0F172A" }}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setShowCode(false)} style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: "#EEF4FF", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ fontWeight: "700", color: "#475569" }}>Cancel</Text>
              </Pressable>
              <GradBtn testID="claim-submit" title="Link" onPress={claim} loading={claiming} style={{ flex: 1 }} height={48} />
            </View>
          </View>
        </View>
      </InlineOverlay>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 12 },
  bellDot: { position: "absolute", top: -6, right: -8, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#22C55E", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  bellTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  panel: { flex: 1, backgroundColor: "#F4F8FF", borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  greetRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  role: { color: "#16A34A", fontWeight: "800", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6 },
  greet: { color: "#0F172A", fontSize: 18, fontWeight: "800", marginTop: 1 },
  greetSub: { color: "#64748B", fontSize: 12, marginTop: 1 },
  tid: { color: "#94A3B8", fontSize: 11, marginTop: 2 },
  emptyCard: { alignItems: "center", gap: 8, backgroundColor: "#fff", borderRadius: 18, padding: 22, marginTop: 16 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  emptySub: { color: "#64748B", textAlign: "center", lineHeight: 19, fontSize: 13 },
  link: { color: "#1F6BFF", fontWeight: "700", fontSize: 13, textAlign: "center" },
  teacherCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 18, padding: 14, marginTop: 16, shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  tLbl: { color: "#1F6BFF", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  tName: { color: "#0F172A", fontSize: 16, fontWeight: "800", marginTop: 1 },
  tMeta: { color: "#64748B", fontSize: 12, marginTop: 1 },
  viewBtn: { paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: "#1F6BFF", alignItems: "center", justifyContent: "center" },
  viewTxt: { color: "#fff", fontSize: 11, fontWeight: "800" },
  feeRow: { flexDirection: "row", gap: 12, marginTop: 14 },
  feeCard: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, padding: 14, height: 76 },
  feeIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  feeLbl: { color: "#475569", fontSize: 12, fontWeight: "600" },
  feeVal: { fontSize: 20, fontWeight: "800" },
  tiles: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5, marginTop: 14 },
  tileCell: { width: "25%", padding: 5 },
  tile: { alignItems: "center", backgroundColor: "#fff", borderRadius: 16, paddingVertical: 12, gap: 7, shadowColor: "#0F172A", shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  tileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  tileLbl: { color: "#0F172A", fontSize: 11, fontWeight: "700" },
  badge: { position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  badgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  secRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 20, marginBottom: 6 },
  sec: { color: "#0F172A", fontSize: 17, fontWeight: "800" },
  viewAll: { color: "#1F6BFF", fontWeight: "700", fontSize: 13 },
  empty: { color: "#64748B", marginTop: 8, fontSize: 13 },
  actRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 12, marginTop: 8 },
  actIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center" },
  actTitle: { color: "#0F172A", fontWeight: "700", fontSize: 14 },
  actMeta: { color: "#94A3B8", fontSize: 12, marginTop: 2 },
});
