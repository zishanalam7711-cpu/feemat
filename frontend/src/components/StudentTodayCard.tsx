import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";

const inr = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const t12 = (t: string) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

// Student home: everything for today in one card (classes, homework, notices, attendance, fee).
export function StudentTodayCard() {
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  useFocusEffect(useCallback(() => { api("/student/today").then(setD).catch(() => {}); }, []));
  if (!d || !d.connected) return null;
  const hw = d.homework, nc = d.next_class;
  const go = (p: string) => router.push(p as any);
  return (
    <View style={s.card} testID="today-card">
      <Text style={s.title}>Today</Text>
      <Pressable onPress={() => go("/student/timetable")} style={s.row}>
        <View style={[s.ic, { backgroundColor: "#E0ECFF" }]}><Ionicons name="time" size={18} color="#1F6BFF" /></View>
        <View style={{ flex: 1 }}>
          {d.classes.length === 0 ? <Text style={s.main}>No classes today</Text> : (
            <>
              <Text style={s.main}>{nc ? `${nc.state === "now" ? "Now: " : "Next: "}${nc.subject} at ${t12(nc.start)}` : "All classes are over for today"}</Text>
              <Text style={s.sub}>{d.classes.length} class{d.classes.length === 1 ? "" : "es"} today{d.classes.some((c: any) => c.cancelled) ? `  •  ${d.classes.filter((c: any) => c.cancelled).length} cancelled` : ""}</Text>
            </>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
      </Pressable>
      <Pressable onPress={() => go("/student/homework")} style={s.row}>
        <View style={[s.ic, { backgroundColor: "#EEF2FF" }]}><Ionicons name="clipboard" size={18} color="#6366F1" /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.main}>{hw.pending ? `${hw.pending} homework to do` : "No homework pending"}</Text>
          <Text style={[s.sub, hw.overdue ? { color: "#DC2626", fontWeight: "700" } : null]}>{hw.overdue ? `${hw.overdue} overdue  •  ` : ""}{hw.items[0] ? `Next: ${hw.items[0].title}` : "You are all caught up"}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
      </Pressable>
      <Pressable onPress={() => go("/student/announcements")} style={s.row}>
        <View style={[s.ic, { backgroundColor: "#FFF1E6" }]}><Ionicons name="megaphone" size={18} color="#F97316" /></View>
        <View style={{ flex: 1 }}><Text style={s.main}>{d.notices.unread ? `${d.notices.unread} new notice${d.notices.unread === 1 ? "" : "s"}` : "No new notices"}</Text></View>
        <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
      </Pressable>
      <View style={s.stats}>
        <Pressable onPress={() => go("/student/attendance")} style={s.stat}><Text style={[s.statV, { color: d.attendance.month_pct != null && d.attendance.month_pct < 75 ? "#DC2626" : "#0D9488" }]}>{d.attendance.month_pct != null ? `${d.attendance.month_pct}%` : "-"}</Text><Text style={s.statL}>Attendance{d.attendance.today ? ` (${d.attendance.today} today)` : ""}</Text></Pressable>
        <Pressable onPress={() => go("/student/payments")} style={s.stat}><Text style={[s.statV, { color: d.fee.due > 0 ? "#DC2626" : "#16A34A" }]}>{d.fee.due > 0 ? inr(d.fee.due) : "Paid"}</Text><Text style={s.statL}>{d.fee.due > 0 ? "Fee due" : "Fees"}</Text></Pressable>
        <Pressable onPress={() => go("/student/results")} style={s.stat}><Text style={[s.statV, { color: "#D97706" }]}>{d.latest_result ? `${d.latest_result.percentage}%` : "-"}</Text><Text style={s.statL} numberOfLines={1}>{d.latest_result ? d.latest_result.title : "Latest result"}</Text></Pressable>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 18, padding: 14, borderWidth: 1, borderColor: "#E2E8F0", marginBottom: 14, gap: 4 },
  title: { fontSize: 16, fontWeight: "900", color: "#0F172A", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  ic: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  main: { fontSize: 14.5, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  stats: { flexDirection: "row", gap: 8, marginTop: 6 },
  stat: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 12, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: "#E2E8F0" },
  statV: { fontSize: 17, fontWeight: "900" },
  statL: { fontSize: 10.5, color: "#64748B", marginTop: 2, fontWeight: "700", paddingHorizontal: 4 },
});
