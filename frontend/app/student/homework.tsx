import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { HomeworkSubmitSheet } from "@/src/components/HomeworkSubmitSheet";

export default function StudentHomework() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stat, setStat] = useState<Record<string, { status: string; late: boolean }>>({});
  const [open, setOpen] = useState<any>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api("/student/homework")); } catch {}
    try { setStat(await api("/student/homework/submissions")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color="#FFFFFF" /></Pressable>
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
             {(() => {
               const st = stat[h.id]?.status;
               const c = st === "reviewed" ? "#16A34A" : st === "redo" ? "#B45309" : "#fff";
               const label = st === "reviewed" ? "Checked - view" : st === "redo" ? "Redo needed - open" : st ? "Sent - view / send again" : "Submit homework (photo)";
               return (
                 <Pressable onPress={() => setOpen(h)} testID={`hw-submit-${h.id}`} style={[styles.subBtn, st ? { backgroundColor: "transparent", borderWidth: 1.5, borderColor: c === "#fff" ? COLORS.brand : c } : null]}>
                   <Ionicons name={st === "reviewed" ? "checkmark-circle" : st ? "cloud-done-outline" : "camera"} size={17} color={st ? (c === "#fff" ? COLORS.brand : c) : "#fff"} />
                   <Text style={[styles.subTxt, st ? { color: c === "#fff" ? COLORS.brand : c } : null]}>{label}</Text>
                 </Pressable>
               );
             })()}
           </View>
         ))}
       </ScrollView>}
      <HomeworkSubmitSheet visible={!!open} homework={open} onClose={() => setOpen(null)} bottomInset={insets.bottom} onChanged={load} />
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: "#071E4A" },
  hTitle: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  empty: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider, gap: SPACING.sm },
  title: { fontSize: 15, fontWeight: "800", color: COLORS.onSurface, flex: 1 },
  desc: { color: COLORS.onSurfaceSecondary, lineHeight: 18 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: COLORS.brandSoft },
  pillTxt: { color: COLORS.brand, fontSize: 11, fontWeight: "700" },
  subBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: RADIUS.md, backgroundColor: COLORS.brand, marginTop: SPACING.xs },
  subTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
