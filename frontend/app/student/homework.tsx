import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

export default function StudentHomework() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setItems(await api("/student/homework")); } catch {} setLoading(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Homework</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View> :
       items.length === 0 ? <View style={styles.center}><Ionicons name="clipboard-outline" size={56} color={COLORS.borderStrong} /><Text style={styles.empty}>No homework yet</Text></View> :
       <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
         {items.map((h) => (
           <View key={h.id} style={styles.card}>
             <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: SPACING.md }}>
               <Text style={styles.title}>{h.title}</Text>
               <View style={styles.pill}><Text style={styles.pillTxt}>Due {h.due_date}</Text></View>
             </View>
             {h.description ? <Text style={styles.desc}>{h.description}</Text> : null}
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
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider, gap: SPACING.sm },
  title: { fontSize: 15, fontWeight: "800", color: COLORS.onSurface, flex: 1 },
  desc: { color: COLORS.onSurfaceSecondary, lineHeight: 18 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: COLORS.brandSoft },
  pillTxt: { color: COLORS.brand, fontSize: 11, fontWeight: "700" },
});
