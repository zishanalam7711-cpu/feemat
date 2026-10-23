import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const todayIdx = () => (new Date().getDay() + 6) % 7; // Monday = 0

function fmt12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function StudentTimetable() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [day, setDay] = useState(todayIdx());

  const load = useCallback(async () => {
    try { setItems(await api("/student/timetable")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const counts = useMemo(() => {
    const c = [0, 0, 0, 0, 0, 0, 0];
    items.forEach((e) => { c[e.day] += 1; });
    return c;
  }, [items]);
  const list = items.filter((e) => e.day === day);

  // the next class that has not started yet (today first, then the following days)
  const next = useMemo(() => {
    if (items.length === 0) return null;
    const t = todayIdx();
    const now = nowHHMM();
    for (let off = 0; off < 7; off++) {
      const d = (t + off) % 7;
      const cand = items.filter((e) => e.day === d && (off > 0 || e.start > now)).sort((a, b) => (a.start < b.start ? -1 : 1))[0];
      if (cand) return { e: cand, label: off === 0 ? "Today" : off === 1 ? "Tomorrow" : FULL[d] };
    }
    return null;
  }, [items]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Timetable</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={56} color={COLORS.muted} />
          <Text style={styles.emptyTitle}>No timetable yet</Text>
          <Text style={{ color: COLORS.muted, textAlign: "center", paddingHorizontal: 30 }}>Your teacher has not added a class schedule yet. Pull down to refresh later.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {next ? (
            <View style={styles.nextCard}>
              <Ionicons name="alarm" size={22} color="#fff" />
              <View style={{ flex: 1 }}>
                <Text style={styles.nextLbl}>Next class • {next.label}</Text>
                <Text style={styles.nextTitle}>{next.e.subject}</Text>
                <Text style={styles.nextMeta}>{fmt12(next.e.start)} - {fmt12(next.e.end)}{next.e.room ? ` • Room ${next.e.room}` : ""}</Text>
              </View>
            </View>
          ) : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {DAYS.map((d, i) => {
              const on = day === i;
              return (
                <Pressable key={d} onPress={() => setDay(i)} style={[styles.dayBtn, on && styles.dayOn]}>
                  <Text style={[styles.dayTxt, on && { color: "#fff" }]}>{d}</Text>
                  <Text style={[styles.dayCount, on && { color: "#fff" }]}>{counts[i] > 0 ? counts[i] : "-"}</Text>
                  {i === todayIdx() ? <View style={styles.todayDot} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <Text style={styles.dayTitle}>{FULL[day]}{day === todayIdx() ? " (Today)" : ""}</Text>
          {list.length === 0 ? (
            <View style={styles.card}><Text style={{ color: COLORS.muted }}>No classes on this day.</Text></View>
          ) : list.map((e) => (
            <View key={e.id} style={styles.card}>
              <View style={styles.timeBox}>
                <Text style={styles.timeTop}>{fmt12(e.start)}</Text>
                <Text style={styles.timeBottom}>{fmt12(e.end)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cTitle}>{e.subject}</Text>
                <Text style={styles.meta}>{e.coaching_name || e.teacher_name}{e.room ? ` • Room ${e.room}` : ""}</Text>
                {e.note ? <Text style={styles.note}>{e.note}</Text> : null}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: SPACING.sm },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  nextCard: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.lg, borderRadius: RADIUS.md, backgroundColor: COLORS.brand },
  nextLbl: { color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: "700" },
  nextTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 2 },
  nextMeta: { color: "rgba(255,255,255,0.9)", fontSize: 13, marginTop: 2 },
  dayBtn: { width: 54, height: 62, borderRadius: 14, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: "center", justifyContent: "center", gap: 2 },
  dayOn: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  dayTxt: { color: COLORS.onSurfaceSecondary, fontWeight: "800", fontSize: 13 },
  dayCount: { color: COLORS.muted, fontSize: 12, fontWeight: "700" },
  todayDot: { position: "absolute", top: 5, right: 6, width: 7, height: 7, borderRadius: 4, backgroundColor: "#F59E0B" },
  dayTitle: { fontSize: 14, fontWeight: "800", color: COLORS.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  card: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  timeBox: { alignItems: "center", paddingRight: SPACING.md, borderRightWidth: 1, borderRightColor: COLORS.divider, minWidth: 74 },
  timeTop: { color: COLORS.onSurface, fontWeight: "800", fontSize: 13 },
  timeBottom: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  cTitle: { color: COLORS.onSurface, fontSize: 16, fontWeight: "800" },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 3 },
  note: { color: COLORS.onSurfaceSecondary, fontSize: 12, marginTop: 4 },
});
