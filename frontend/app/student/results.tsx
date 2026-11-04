import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { ReportCardView } from "@/src/components/ReportCardView";

export default function StudentResults() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try { setData(await api("/student/report-card")); } catch (e: any) { setErr(e?.message || "Could not load your results."); }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  return (
    <View style={{ flex: 1, backgroundColor: "#F1F5F9" }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color="#FFFFFF" /></Pressable>
        <Text style={styles.hTitle}>My Results</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
        : err ? <View style={styles.center}><Ionicons name="alert-circle-outline" size={48} color={COLORS.borderStrong} /><Text style={styles.empty}>{err}</Text></View>
        : <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}><ReportCardView data={data} /></ScrollView>}
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: "#071E4A" },
  hTitle: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  empty: { fontSize: 15, fontWeight: "700", color: COLORS.onSurface, textAlign: "center" },
});
