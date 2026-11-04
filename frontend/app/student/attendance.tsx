import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { addDaysYmd, localToday } from "@/src/lib/hwFiles";

const COL: Record<string, string> = { present: "#16A34A", absent: "#DC2626", late: "#D97706", leave: "#2563EB" };
const LBL: Record<string, string> = { present: "Present", absent: "Absent", late: "Late", leave: "Leave" };
const addMonths = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const monthLabel = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }); };

export default function StudentAttendance() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const thisMonth = localToday().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { setData(await api(`/student/attendance?month=${month}`)); } catch (e: any) { setErr(e?.message || "Could not load your attendance."); }
    setLoading(false);
  }, [month]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const [y, mo] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const pctColor = (p: number | null) => (p == null ? "#64748B" : p >= 90 ? "#16A34A" : p >= 75 ? "#D97706" : "#DC2626");

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color="#FFFFFF" /></Pressable>
        <Text style={styles.hTitle}>My Attendance</Text>
        <View style={{ width: 26 }} />
      </View>
      {err ? <View style={styles.center}><Text style={styles.empty}>{err}</Text></View> : (
        <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
          <View style={styles.monthRow}>
            <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={10} style={styles.nav}><Ionicons name="chevron-back" size={20} color="#fff" /></Pressable>
            <Text style={styles.monthTxt}>{monthLabel(month)}</Text>
            <Pressable onPress={() => month < thisMonth && setMonth(addMonths(month, 1))} hitSlop={10} style={[styles.nav, month >= thisMonth && { opacity: 0.3 }]}><Ionicons name="chevron-forward" size={20} color="#fff" /></Pressable>
          </View>
          {loading || !data ? <ActivityIndicator color={COLORS.brand} style={{ margin: 30 }} /> : (
            <>
              <View style={styles.hero}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroLbl}>This month</Text>
                  <Text style={[styles.heroPct, { color: pctColor(data.month_pct) }]}>{data.month_pct != null ? `${data.month_pct}%` : "-"}</Text>
                  <Text style={styles.heroSub}>{data.total} day{data.total === 1 ? "" : "s"} marked</Text>
                </View>
                <View style={styles.vline} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.heroLbl}>Overall</Text>
                  <Text style={[styles.heroPct, { color: pctColor(data.overall_pct) }]}>{data.overall_pct != null ? `${data.overall_pct}%` : "-"}</Text>
                  <Text style={styles.heroSub}>{data.overall_days} days in total</Text>
                </View>
              </View>
              {data.month_pct != null && data.month_pct < 75 ? <View style={styles.warn}><Ionicons name="alert-circle" size={18} color="#B45309" /><Text style={styles.warnTxt}>Your attendance is below 75%. Please attend regularly.</Text></View> : null}

              <View style={styles.stats}>
                {(["present", "absent", "late", "leave"] as const).map((k) => (
                  <View key={k} style={styles.stat}><Text style={[styles.statV, { color: COL[k] }]}>{data.counts[k]}</Text><Text style={styles.statL}>{LBL[k]}</Text></View>
                ))}
              </View>

              <View style={styles.cal}>
                <View style={styles.week}>{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <Text key={i} style={styles.wd}>{d}</Text>)}</View>
                {Array.from({ length: cells.length / 7 }, (_, r) => (
                  <View key={r} style={styles.week}>
                    {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
                      const ymd = d ? `${month}-${String(d).padStart(2, "0")}` : "";
                      const st = d ? data.days[ymd] : null;
                      return (
                        <View key={i} style={styles.cellWrap}>
                          {d ? <View style={[styles.cell, st && { backgroundColor: COL[st] }, ymd === localToday() && !st && styles.today]}><Text style={[styles.cellTxt, st && { color: "#fff" }]}>{d}</Text></View> : null}
                        </View>
                      );
                    })}
                  </View>
                ))}
                <View style={styles.legend}>{(["present", "absent", "late", "leave"] as const).map((k) => <View key={k} style={styles.lg}><View style={[styles.lgDot, { backgroundColor: COL[k] }]} /><Text style={styles.lgTxt}>{LBL[k]}</Text></View>)}</View>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: "#071E4A" },
  hTitle: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl },
  empty: { fontSize: 15, fontWeight: "700", color: COLORS.onSurface, textAlign: "center" },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#0E2A63", borderRadius: RADIUS.md, padding: 8 },
  nav: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  monthTxt: { flex: 1, textAlign: "center", color: "#fff", fontSize: 16, fontWeight: "800" },
  hero: { flexDirection: "row", backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: 18, borderWidth: 1, borderColor: COLORS.divider, alignItems: "center" },
  vline: { width: 1, alignSelf: "stretch", backgroundColor: COLORS.divider, marginHorizontal: 14 },
  heroLbl: { fontSize: 12, color: COLORS.muted, fontWeight: "700" },
  heroPct: { fontSize: 36, fontWeight: "900", marginTop: 2 },
  heroSub: { fontSize: 12, color: COLORS.muted },
  warn: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12 },
  warnTxt: { flex: 1, color: "#92400E", fontSize: 13, fontWeight: "600" },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 14, padding: 12, alignItems: "center", borderWidth: 1, borderColor: COLORS.divider },
  statV: { fontSize: 22, fontWeight: "900" },
  statL: { fontSize: 11, color: COLORS.muted, fontWeight: "700", marginTop: 2 },
  cal: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: 12, borderWidth: 1, borderColor: COLORS.divider, gap: 6 },
  week: { flexDirection: "row" },
  wd: { flex: 1, textAlign: "center", color: COLORS.muted, fontSize: 12, fontWeight: "800" },
  cellWrap: { flex: 1, alignItems: "center", paddingVertical: 3 },
  cell: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#F1F5F9" },
  today: { borderWidth: 2, borderColor: COLORS.brand },
  cellTxt: { fontSize: 13, fontWeight: "700", color: "#334155" },
  legend: { flexDirection: "row", justifyContent: "center", gap: 14, marginTop: 6 },
  lg: { flexDirection: "row", alignItems: "center", gap: 5 },
  lgDot: { width: 10, height: 10, borderRadius: 5 },
  lgTxt: { fontSize: 11.5, color: COLORS.muted, fontWeight: "600" },
});
