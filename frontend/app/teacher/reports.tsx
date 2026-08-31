import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

export default function Reports() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => { setLoading(true); try { setData(await api("/teacher/reports")); } catch {} setLoading(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;

  const maxVal = Math.max(1, ...(data.monthly_collection || []).map((x: any) => x.amount));

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Reports & Analytics</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
        <View style={styles.card}>
          <Text style={styles.sect}>Monthly Collection (last 7 months)</Text>
          <View style={styles.chart}>
            {data.monthly_collection.map((x: any) => (
              <View key={x.month} style={styles.bar}>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { height: `${(x.amount / maxVal) * 100}%` }]} />
                </View>
                <Text style={styles.barLbl}>{x.month.slice(5)}</Text>
                <Text style={styles.barAmt}>{inr(x.amount)}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Top Defaulters</Text>
          {data.defaulters.length === 0 ? (
            <Text style={{ color: COLORS.muted, marginTop: SPACING.sm }}>No due fees. 🎉</Text>
          ) : data.defaulters.map((d: any) => (
            <Pressable key={d.connection_id} style={styles.defRow} onPress={() => router.push(`/teacher/student/${d.connection_id}`)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.defName}>{d.name}</Text>
                <Text style={styles.meta}>{d.admission_number}</Text>
              </View>
              <Text style={styles.defAmt}>{inr(d.due)}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Today's Attendance</Text>
          <Text style={styles.big}>{data.today_attendance}</Text>
          <Text style={styles.meta}>students marked today</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  sect: { fontSize: 14, fontWeight: "800", color: COLORS.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  chart: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.lg, height: 200 },
  bar: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  barTrack: { width: "70%", height: 140, backgroundColor: COLORS.surfaceSecondary, borderRadius: 8, justifyContent: "flex-end", overflow: "hidden" },
  barFill: { backgroundColor: COLORS.brand, borderRadius: 8 },
  barLbl: { color: COLORS.muted, fontSize: 10 },
  barAmt: { color: COLORS.onSurface, fontSize: 10, fontWeight: "700" },
  defRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.divider, marginTop: SPACING.sm },
  defName: { color: COLORS.onSurface, fontWeight: "700" },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  defAmt: { color: COLORS.error, fontWeight: "800" },
  big: { fontSize: 40, fontWeight: "900", color: COLORS.onSurface, marginTop: SPACING.sm },
});
