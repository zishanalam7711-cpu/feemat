import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Image } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { HomeworkPhotoViewer } from "@/src/components/HomeworkPhotoViewer";
import { dataUri, fmtWhen } from "@/src/lib/hwFiles";

const CATS: Record<string, { e: string; c: string }> = {
  Notice: { e: "📢", c: "#2563EB" }, Holiday: { e: "🏖️", c: "#059669" }, Exam: { e: "📝", c: "#D97706" },
  Fee: { e: "💰", c: "#DB2777" }, Event: { e: "🎉", c: "#7C3AED" }, Other: { e: "📌", c: "#475569" },
};

export default function StudentAnnouncements() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const load = useCallback(async () => {
    setErr("");
    try {
      const list: any[] = await api("/student/announcements");
      setItems(list || []);
      // opening the screen counts as reading: the teacher sees "Seen by X of Y"
      await Promise.all((list || []).filter((a) => !a.read).map((a) => api(`/student/announcements/${a.id}/read`, { method: "POST" }).catch(() => null)));
    } catch (e: any) { setErr(e?.message || "Could not load the notices."); }
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color="#FFFFFF" /></Pressable>
        <Text style={styles.hTitle}>Notices</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
        : err ? <View style={styles.center}><Text style={styles.empty}>{err}</Text></View>
        : items.length === 0 ? <View style={styles.center}><Ionicons name="megaphone-outline" size={56} color={COLORS.borderStrong} /><Text style={styles.empty}>No notices yet</Text></View>
        : (
          <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
            {items.map((a) => {
              const c = CATS[a.category] || CATS.Notice;
              return (
                <View key={a.id} style={[styles.card, a.important && { borderColor: "#F59E0B", borderWidth: 1.5 }]}>
                  <View style={styles.top}>
                    <View style={[styles.chip, { backgroundColor: c.c + "1A" }]}><Text style={[styles.chipTxt, { color: c.c }]}>{c.e} {a.category || "Notice"}</Text></View>
                    {a.important ? <View style={styles.imp}><Ionicons name="pin" size={12} color="#B45309" /><Text style={styles.impTxt}>Important</Text></View> : null}
                    <View style={{ flex: 1 }} />
                    {!a.read ? <View style={styles.newDot}><Text style={styles.newTxt}>NEW</Text></View> : null}
                  </View>
                  <Text style={styles.title}>{a.title}</Text>
                  {a.body ? <Text style={styles.body}>{a.body}</Text> : null}
                  {a.attachments?.length ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {a.attachments.map((p: any) => (
                        <Pressable key={p.id} onPress={() => setPhoto(p.id)}>
                          {p.thumb ? <Image source={{ uri: dataUri(p.mime, p.thumb) }} style={styles.thumb} /> : <View style={[styles.thumb, { alignItems: "center", justifyContent: "center" }]}><Ionicons name="image" size={22} color={COLORS.borderStrong} /></View>}
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : null}
                  <Text style={styles.when}>{fmtWhen(a.created_at)}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      <HomeworkPhotoViewer fileId={photo} role="student" kind="notice" onClose={() => setPhoto(null)} />
    </View>
  );
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: "#071E4A" },
  hTitle: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  empty: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md, textAlign: "center" },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider, gap: SPACING.sm },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipTxt: { fontSize: 11.5, fontWeight: "800" },
  imp: { flexDirection: "row", alignItems: "center", gap: 3 },
  impTxt: { color: "#B45309", fontSize: 11, fontWeight: "800" },
  newDot: { backgroundColor: "#EF4444", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  newTxt: { color: "#fff", fontSize: 9.5, fontWeight: "900" },
  title: { fontSize: 16, fontWeight: "800", color: COLORS.onSurface },
  body: { color: COLORS.onSurface, lineHeight: 21, fontSize: 14 },
  thumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: COLORS.surfaceSecondary },
  when: { color: COLORS.muted, fontSize: 11.5 },
});
