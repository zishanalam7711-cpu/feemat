import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { dayLabel, localToday } from "@/src/lib/hwFiles";

type Role = "teacher" | "student";
const KIND: Record<string, { i: any; c: string }> = {
  success: { i: "checkmark-circle", c: "#16A34A" }, warning: { i: "alert-circle", c: "#D97706" }, fee: { i: "wallet", c: "#EC4899" },
  result: { i: "ribbon", c: "#F59E0B" }, homework: { i: "clipboard", c: "#6366F1" }, announcement: { i: "megaphone", c: "#F97316" }, info: { i: "information-circle", c: "#2563EB" },
};

function routeFor(role: Role, n: any): string | null {
  const t = String(n.title || "").toLowerCase();
  if (role === "student") {
    if (n.kind === "homework") return "/student/homework";
    if (n.kind === "announcement") return "/student/announcements";
    if (n.kind === "result") return "/student/results";
    if (t.includes("attendance")) return "/student/attendance";
    if (t.includes("class") || t.includes("timetable")) return "/student/timetable";
    if (t.includes("payment") || t.includes("fee") || n.kind === "fee") return "/student/payments";
    return null;
  }
  if (t.includes("payment to confirm")) return "/teacher/payments";
  if (n.kind === "homework" || t.includes("homework")) return "/teacher/homework";
  return null;
}
function localDate(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now"; if (m < 60) return `${m} min ago`; if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// One notifications screen for teacher and student: grouped by day, icons, unread filter, open the right screen, delete.
export function NotificationsList({ role, dark }: { role: Role; dark: boolean }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const T = dark ? { bg: "#071B45", card: "#0E2A63", unread: "#143A82", text: "#FFFFFF", sub: "rgba(255,255,255,0.6)", head: "#071B45", chip: "rgba(255,255,255,0.08)" }
                 : { bg: "#F1F5F9", card: "#FFFFFF", unread: "#EAF2FF", text: "#0F172A", sub: "#64748B", head: "#071E4A", chip: "#E2E8F0" };
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { setItems(await api("/notifications")); } catch {} setLoading(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const open = async (n: any) => {
    if (!n.read) { try { await api(`/notifications/${n.id}/read`, { method: "POST" }); setItems((p) => p.map((x) => (x.id === n.id ? { ...x, read: true } : x))); } catch {} }
    const r = routeFor(role, n);
    if (r) router.push(r as any);
  };
  const remove = (n: any) => Alert.alert("Delete this notification?", n.title, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/notifications/${n.id}`, { method: "DELETE" }); setItems((p) => p.filter((x) => x.id !== n.id)); } catch {} } },
  ]);
  const readAll = async () => { try { await api("/notifications/read-all", { method: "POST" }); setItems((p) => p.map((x) => ({ ...x, read: true }))); } catch {} };
  const clearRead = () => Alert.alert("Clear read notifications?", "Notifications you have already read will be removed.", [
    { text: "Cancel", style: "cancel" },
    { text: "Clear", style: "destructive", onPress: async () => { try { await api("/notifications/clear-read", { method: "POST" }); setItems((p) => p.filter((x) => !x.read)); } catch {} } },
  ]);

  const unread = items.filter((n) => !n.read).length;
  const groups = useMemo(() => {
    const today = localToday();
    const g: Record<string, any[]> = {};
    items.filter((n) => !unreadOnly || !n.read).forEach((n) => { const d = localDate(n.created_at); const k = dayLabel(d, today) === "Today" || dayLabel(d, today) === "Yesterday" ? dayLabel(d, today) : "Earlier"; (g[k] = g[k] || []).push(n); });
    return ["Today", "Yesterday", "Earlier"].filter((k) => g[k]).map((k) => ({ k, list: g[k] }));
  }, [items, unreadOnly]);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={[s.header, { paddingTop: insets.top + 12, backgroundColor: T.head }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color="#fff" /></Pressable>
        <View style={{ flex: 1 }}><Text style={s.title}>Notifications</Text><Text style={s.sub}>{unread} unread</Text></View>
        {unread > 0 ? <Pressable onPress={readAll} hitSlop={8} style={s.hBtn} testID="read-all"><Ionicons name="checkmark-done" size={16} color="#fff" /><Text style={s.hTxt}>Read all</Text></Pressable> : null}
        <Pressable onPress={clearRead} hitSlop={8} style={s.hBtn} testID="clear-read"><Ionicons name="trash-outline" size={16} color="#fff" /></Pressable>
      </View>
      <View style={s.chips}>
        {([[false, "All"], [true, `Unread (${unread})`]] as [boolean, string][]).map(([v, l]) => (
          <Pressable key={l} onPress={() => setUnreadOnly(v)} style={[s.chip, { backgroundColor: T.chip }, unreadOnly === v && s.chipOn]}><Text style={[s.chipTxt, { color: T.sub }, unreadOnly === v && { color: "#fff" }]}>{l}</Text></Pressable>
        ))}
      </View>
      {loading ? <View style={s.center}><ActivityIndicator color="#1F6BFF" /></View> : groups.length === 0 ? (
        <View style={s.center}><Ionicons name="notifications-off-outline" size={52} color={T.sub} /><Text style={[s.empty, { color: T.text }]}>{unreadOnly ? "Nothing unread" : "No notifications yet"}</Text></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40, gap: 8 }}>
          {groups.map((g) => (
            <View key={g.k} style={{ gap: 8 }}>
              <Text style={[s.group, { color: T.sub }]}>{g.k}</Text>
              {g.list.map((n) => {
                const k = KIND[n.kind] || KIND.info;
                return (
                  <Pressable key={n.id} onPress={() => open(n)} onLongPress={() => remove(n)} style={[s.row, { backgroundColor: n.read ? T.card : T.unread }]} testID={`notif-${n.id}`}>
                    <View style={[s.ic, { backgroundColor: k.c + "26" }]}><Ionicons name={k.i} size={20} color={k.c} /></View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Text style={[s.nTitle, { color: T.text }]} numberOfLines={1}>{n.title}</Text>{!n.read ? <View style={s.dot} /> : null}</View>
                      <Text style={[s.nBody, { color: T.sub }]}>{n.body}</Text>
                      <Text style={[s.nTime, { color: T.sub }]}>{ago(n.created_at)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          <Text style={[s.hint, { color: T.sub }]}>Tap to open. Press and hold to delete.</Text>
        </ScrollView>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 12 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 1 },
  hBtn: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.14)", borderRadius: 999, paddingHorizontal: 12, height: 32 },
  hTxt: { color: "#fff", fontWeight: "700", fontSize: 12 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  chip: { paddingHorizontal: 14, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#1F6BFF" },
  chipTxt: { fontSize: 13, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  empty: { fontSize: 15, fontWeight: "700" },
  group: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 6 },
  row: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 14 },
  ic: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  nTitle: { fontSize: 14.5, fontWeight: "800", flexShrink: 1 },
  nBody: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  nTime: { fontSize: 11, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444" },
  hint: { textAlign: "center", fontSize: 11.5, marginTop: 10 },
});
