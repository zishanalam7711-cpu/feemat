import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Image } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { HomeworkSubmitSheet } from "@/src/components/HomeworkSubmitSheet";
import { HomeworkPhotoViewer } from "@/src/components/HomeworkPhotoViewer";
import { dataUri, dayLabel, localToday } from "@/src/lib/hwFiles";

const SUBJECT_COLORS: Record<string, string> = {
  Maths: "#D97706", Science: "#059669", English: "#4F46E5", Hindi: "#DC2626", SST: "#0D9488", Computer: "#0284C7", GK: "#DB2777",
};
const subjectColor = (s: string) => SUBJECT_COLORS[s] || "#475569";

export default function StudentHomework() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = localToday();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stat, setStat] = useState<Record<string, { status: string; late: boolean }>>({});
  const [open, setOpen] = useState<any>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api("/student/homework")); } catch {}
    try { setStat(await api("/student/homework/submissions")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // homework grouped by the day it was given (newest day first): one place for each day's homework
  const days = useMemo(() => {
    const m: Record<string, any[]> = {};
    items.forEach((h) => { (m[h.assigned_date] = m[h.assigned_date] || []).push(h); });
    return Object.keys(m).sort().reverse().map((d) => ({ day: d, list: m[d] }));
  }, [items]);

  const dueTxt = (due: string) => {
    const n = Math.round((new Date(due + "T00:00:00Z").getTime() - new Date(today + "T00:00:00Z").getTime()) / 86400000);
    return n < 0 ? { t: "Last date over", c: "#94A3B8" } : n === 0 ? { t: "Due today", c: "#DC2626" } : n === 1 ? { t: "Due tomorrow", c: "#D97706" } : { t: `Due ${due}`, c: COLORS.brand };
  };

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
         {days.map(({ day, list }) => (
           <View key={day} style={{ gap: SPACING.sm }}>
             <View style={styles.dayHead}>
               <Text style={styles.dayTitle}>{dayLabel(day, today)}</Text>
               <Text style={styles.dayCount}>{list.length} homework  •  {day}</Text>
             </View>
             {list.map((h) => {
               const st = stat[h.id]?.status;
               const c = st === "reviewed" ? "#16A34A" : st === "redo" ? "#B45309" : COLORS.brand;
               const label = st === "reviewed" ? "Checked - view" : st === "redo" ? "Redo needed - open" : st ? "Sent - view / send again" : "Submit homework (photo)";
               const d = dueTxt(h.due_date);
               return (
                 <View key={h.id} style={styles.card}>
                   <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: SPACING.md }}>
                     <View style={{ flex: 1 }}>
                       {h.subject ? <View style={[styles.subj, { backgroundColor: subjectColor(h.subject) + "1A" }]}><Text style={[styles.subjTxt, { color: subjectColor(h.subject) }]}>{h.subject}</Text></View> : null}
                       <Text style={styles.title}>{h.title}</Text>
                     </View>
                     <View style={[styles.pill, { backgroundColor: d.c + "1A" }]}><Text style={[styles.pillTxt, { color: d.c }]}>{d.t}</Text></View>
                   </View>
                   {h.description ? <Text style={styles.desc}>{h.description}</Text> : null}
                   {h.attachments?.length ? (
                     <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                       {h.attachments.map((a: any) => (
                         <Pressable key={a.id} onPress={() => setPhoto(a.id)} testID="hw-task-photo">
                           {a.thumb ? <Image source={{ uri: dataUri(a.mime, a.thumb) }} style={styles.thumb} /> : <View style={[styles.thumb, { alignItems: "center", justifyContent: "center" }]}><Ionicons name="image" size={22} color={COLORS.borderStrong} /></View>}
                         </Pressable>
                       ))}
                     </ScrollView>
                   ) : null}
                   <Pressable onPress={() => setOpen(h)} testID={`hw-submit-${h.id}`} style={[styles.subBtn, st ? { backgroundColor: "transparent", borderWidth: 1.5, borderColor: c } : null]}>
                     <Ionicons name={st === "reviewed" ? "checkmark-circle" : st ? "cloud-done-outline" : "camera"} size={17} color={st ? c : "#fff"} />
                     <Text style={[styles.subTxt, st ? { color: c } : null]}>{label}</Text>
                   </Pressable>
                 </View>
               );
             })}
           </View>
         ))}
       </ScrollView>}
      <HomeworkSubmitSheet visible={!!open} homework={open} onClose={() => setOpen(null)} bottomInset={insets.bottom} onChanged={load} />
      <HomeworkPhotoViewer fileId={photo} role="student" kind="attachment" onClose={() => setPhoto(null)} />
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: "#071E4A" },
  hTitle: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  empty: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  dayHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: SPACING.sm },
  dayTitle: { fontSize: 17, fontWeight: "800", color: COLORS.onSurface },
  dayCount: { fontSize: 12, color: COLORS.onSurfaceSecondary },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider, gap: SPACING.sm },
  subj: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, marginBottom: 5 },
  subjTxt: { fontSize: 11, fontWeight: "800" },
  title: { fontSize: 16, fontWeight: "800", color: COLORS.onSurface },
  desc: { color: COLORS.onSurface, lineHeight: 21, fontSize: 14 },
  thumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: COLORS.surfaceSecondary },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillTxt: { fontSize: 11, fontWeight: "700" },
  subBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: RADIUS.md, backgroundColor: COLORS.brand, marginTop: SPACING.xs },
  subTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
