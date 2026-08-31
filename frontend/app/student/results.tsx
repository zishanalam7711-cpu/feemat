import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

export default function StudentResults() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setItems(await api("/student/results")); } catch {} setLoading(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Results</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View> :
       items.length === 0 ? <View style={styles.center}><Ionicons name="ribbon-outline" size={56} color={COLORS.borderStrong} /><Text style={styles.empty}>No results yet</Text></View> :
       <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
         {items.map((r) => (
           <View key={r.id || r.exam_id} style={styles.card}>
             <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
               <View style={{ flex: 1 }}>
                 <Text style={styles.title}>{r.exam?.title}</Text>
                 <Text style={styles.meta}>{r.exam?.subject || "General"} • {r.exam?.exam_date}</Text>
               </View>
               <View style={[styles.gradeCircle, { backgroundColor: r.result === "pass" ? "#DCFCE7" : "#FEE2E2" }]}>
                 <Text style={{ color: r.result === "pass" ? "#065F46" : "#991B1B", fontWeight: "800" }}>{r.grade}</Text>
               </View>
             </View>
             <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: SPACING.sm }}>
               <Text style={styles.big}>{r.marks} / {r.exam?.total_marks}</Text>
               <Text style={styles.pct}>{r.percentage}%</Text>
             </View>
           </View>
         ))}
       </ScrollView>}
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  empty: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  title: { fontSize: 15, fontWeight: "800", color: COLORS.onSurface },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  gradeCircle: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  big: { fontSize: 22, fontWeight: "900", color: COLORS.onSurface },
  pct: { fontSize: 22, fontWeight: "900", color: COLORS.brand },
});
