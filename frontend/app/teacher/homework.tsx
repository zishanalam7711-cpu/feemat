import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Share, Image } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { ProUpgradeModal } from "@/src/components/ProUpgradeModal";
import { HomeworkSubmissions } from "@/src/components/HomeworkSubmissions";
import { HomeworkComposer } from "@/src/components/HomeworkComposer";
import { HomeworkPhotoViewer } from "@/src/components/HomeworkPhotoViewer";
import { audienceLabel } from "@/src/components/AudiencePicker";
import { addDaysYmd, dataUri, dayLabel, localToday } from "@/src/lib/hwFiles";

const DARK = {
  bg: "#071B45", card: "#0E2A63", border: "rgba(255,255,255,0.08)", text: "#FFFFFF", sub: "rgba(255,255,255,0.6)", input: "rgba(255,255,255,0.07)",
};
const SUBJECT_COLORS: Record<string, string> = {
  Maths: "#F59E0B", Science: "#10B981", English: "#6366F1", Hindi: "#EF4444", SST: "#14B8A6", Computer: "#0EA5E9", GK: "#EC4899",
};
const subjectColor = (s: string) => SUBJECT_COLORS[s] || "#8B9BC0";

function daysLeft(due: string) {
  const a = new Date(due + "T00:00:00Z").getTime();
  const b = new Date(localToday() + "T00:00:00Z").getTime();
  return Math.round((a - b) / 86400000);
}
function dueBadge(due: string) {
  const n = daysLeft(due);
  if (isNaN(n)) return { txt: due, color: "#9CA3AF" };
  if (n < 0) return { txt: `Ended ${Math.abs(n)} day(s) ago`, color: "#9CA3AF" };
  if (n === 0) return { txt: "Due today", color: "#EF4444" };
  if (n === 1) return { txt: "Due tomorrow", color: "#F59E0B" };
  if (n <= 3) return { txt: `${n} days left`, color: "#F59E0B" };
  return { txt: `${n} days left`, color: "#10B981" };
}

type Mode = "daily" | "upcoming" | "past" | "all";

export default function Homework() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const today = localToday();
  const [items, setItems] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("daily");
  const [day, setDay] = useState(today);
  const [compose, setCompose] = useState(false);
  const [pro, setPro] = useState(false);
  const [counts, setCounts] = useState<Record<string, any>>({});
  const [subFor, setSubFor] = useState<any>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const stripRef = useRef<ScrollView>(null);
  const loadCounts = useCallback(async () => { try { setCounts(await api("/teacher/homework/submission-counts")); } catch {} }, []);

  const load = useCallback(async () => {
    try {
      const [h, c, b, s]: any = await Promise.all([
        api("/teacher/homework"),
        api("/teacher/classes").catch(() => []),
        api("/teacher/batches").catch(() => []),
        api("/teacher/students?filter=all&limit=200").catch(() => ({ items: [] })),
      ]);
      setItems(h || []); setClasses(c || []); setBatches(b || []); setStudents(s.items || []);
      loadCounts();
    } catch {}
    setLoading(false);
  }, [loadCounts]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const byDay = useMemo(() => {
    const m: Record<string, any[]> = {};
    items.forEach((h) => { (m[h.assigned_date] = m[h.assigned_date] || []).push(h); });
    return m;
  }, [items]);

  const list = useMemo(() => {
    if (mode === "daily") return (byDay[day] || []).slice().reverse();
    const up = items.filter((h) => h.due_date >= today).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    const past = items.filter((h) => h.due_date < today).sort((a, b) => (a.due_date < b.due_date ? 1 : -1));
    return mode === "upcoming" ? up : mode === "past" ? past : [...up, ...past];
  }, [items, mode, day, byDay, today]);

  const strip = useMemo(() => Array.from({ length: 12 }, (_, i) => addDaysYmd(today, 1 - i)), [today]); // tomorrow .. 10 days back
  const activeCount = useMemo(() => items.filter((h) => h.due_date >= today).length, [items, today]);

  const shareDay = async () => {
    const hs = (byDay[day] || []).slice().reverse();
    if (!hs.length) return;
    const lines = hs.map((h, i) => `${i + 1}) ${h.subject ? h.subject + ": " : ""}${h.title}${h.description ? "\n" + h.description : ""}${h.attachments?.length ? `\n(${h.attachments.length} photo in the FeeMat app)` : ""}\nLast date: ${h.due_date}`);
    try { await Share.share({ message: `📚 Homework - ${dayLabel(day, today)} (${day})\n\n${lines.join("\n\n")}` }); } catch {}
  };

  const remove = (h: any) => {
    Alert.alert("Delete this homework?", `"${h.title}" will be removed for the students, together with its photos and any homework they sent.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api(`/teacher/homework/${h.id}`, { method: "DELETE" }); await load(); }
        catch (e: any) { Alert.alert("Could not delete", e?.message || "Please try again."); }
      } },
    ]);
  };

  const card = (h: any) => {
    const b = dueBadge(h.due_date);
    const c = counts[h.id];
    const sent = c?.sent ?? 0, fresh = c?.submitted ?? 0;
    return (
      <View key={h.id} style={styles.card}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm }}>
          <View style={{ flex: 1 }}>
            {h.subject ? <View style={[styles.subjChip, { backgroundColor: subjectColor(h.subject) + "33" }]}><Text style={[styles.subjTxt, { color: subjectColor(h.subject) }]}>{h.subject}</Text></View> : null}
            <Text style={styles.cTitle}>{h.title}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: b.color + "26" }]}><Text style={[styles.badgeTxt, { color: b.color }]}>{b.txt}</Text></View>
          <Pressable onPress={() => remove(h)} hitSlop={10} testID={`hw-del-${h.id}`}><Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.45)" /></Pressable>
        </View>
        {h.description ? <Text style={styles.body}>{h.description}</Text> : null}
        {h.attachments?.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {h.attachments.map((a: any) => (
              <Pressable key={a.id} onPress={() => setPhoto(a.id)} testID="hw-task-photo">
                {a.thumb ? <Image source={{ uri: dataUri(a.mime, a.thumb) }} style={styles.thumb} /> : <View style={[styles.thumb, { alignItems: "center", justifyContent: "center" }]}><Ionicons name="image" size={22} color={DARK.sub} /></View>}
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View style={styles.metaRow}>
          <Ionicons name="calendar" size={12} color={DARK.sub} />
          <Text style={styles.meta}>Given {dayLabel(h.assigned_date, today)}  •  Last date {h.due_date}</Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="people" size={12} color={DARK.sub} />
          <Text style={styles.meta}>{audienceLabel(h, classes, batches)}</Text>
        </View>
        <Pressable onPress={() => setSubFor(h)} testID={`hw-subs-${h.id}`} style={styles.subsBtn}>
          <Ionicons name="albums-outline" size={16} color="#fff" />
          <Text style={styles.subsTxt}>Submissions{c ? `  ${sent}/${c.total}` : ""}</Text>
          {fresh > 0 ? <View style={styles.newDot}><Text style={styles.newDotTxt}>{fresh} new</Text></View> : null}
        </Pressable>
      </View>
    );
  };

  const dayItems = byDay[day] || [];
  const subjects = Array.from(new Set(dayItems.map((h) => h.subject).filter(Boolean)));

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Homework</Text>
          <Text style={styles.sub}>{activeCount} active  •  {(byDay[today] || []).length} given today</Text>
        </View>
        <Pressable testID="new-hw" onPress={() => setCompose(true)} style={styles.addBtn}>
          <Ionicons name="add" size={18} color="#fff" /><Text style={styles.addTxt}>New</Text>
        </Pressable>
      </View>

      <View style={styles.filters}>
        {([["daily", "Daily"], ["upcoming", "Active"], ["past", "Past"], ["all", "All"]] as [Mode, string][]).map(([k, l]) => (
          <Pressable key={k} onPress={() => setMode(k)} style={[styles.fChip, mode === k && styles.fChipOn]} testID={`hw-mode-${k}`}>
            <Text style={[styles.fTxt, mode === k && { color: "#fff" }]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      {mode === "daily" ? (
        <View>
          <ScrollView ref={stripRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} onContentSizeChange={() => stripRef.current?.scrollToEnd({ animated: false })}>
            {strip.slice().reverse().map((d) => {
              const n = (byDay[d] || []).length;
              const sel = d === day;
              const dt = new Date(d + "T00:00:00Z");
              return (
                <Pressable key={d} onPress={() => setDay(d)} style={[styles.dayChip, sel && styles.dayChipOn]} testID={`hw-day-${d}`}>
                  <Text style={[styles.dayName, sel && { color: "#fff" }]}>{d === today ? "Today" : dt.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}</Text>
                  <Text style={[styles.dayNum, sel && { color: "#fff" }]}>{dt.getUTCDate()}</Text>
                  <View style={[styles.dayDot, { backgroundColor: n ? (sel ? "#fff" : "#35A7FF") : "transparent" }]}>{n ? <Text style={[styles.dayCnt, sel && { color: "#1F6BFF" }]}>{n}</Text> : null}</View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.daySummary}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dayTitle}>{dayLabel(day, today)}  •  {day}</Text>
              <Text style={styles.sub}>{dayItems.length ? `${dayItems.length} homework${subjects.length ? "  •  " + subjects.join(", ") : ""}` : "No homework on this day"}</Text>
            </View>
            {dayItems.length ? <Pressable onPress={shareDay} style={styles.shareBtn} testID="hw-share-day"><Ionicons name="share-social" size={15} color="#fff" /><Text style={styles.shareTxt}>Share</Text></Pressable> : null}
          </View>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#35A7FF" /></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="clipboard-outline" size={56} color="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTxt}>{mode === "daily" ? "No homework on this day" : mode === "past" ? "No past homework" : "No homework yet"}</Text>
          <Pressable onPress={() => setCompose(true)} style={styles.emptyBtn}><Ionicons name="add" size={18} color="#fff" /><Text style={styles.addTxt}>{mode === "daily" ? "Add homework for this day" : "New homework"}</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: 120 }}>
          {list.map(card)}
        </ScrollView>
      )}

      {!loading && list.length > 0 ? (
        <Pressable onPress={() => setCompose(true)} style={[styles.fab, { bottom: insets.bottom + 18 }]} testID="hw-fab">
          <Ionicons name="add" size={22} color="#fff" /><Text style={styles.fabTxt}>New homework</Text>
        </Pressable>
      ) : null}

      <HomeworkComposer visible={compose} onClose={() => setCompose(false)} classes={classes} batches={batches} students={students} bottomInset={insets.bottom}
        defaultDate={mode === "daily" ? day : today} onCreated={load} onNeedPro={() => setPro(true)} />
      <ProUpgradeModal visible={pro} onClose={() => setPro(false)} feature="Homework" />
      <HomeworkSubmissions visible={!!subFor} homework={subFor} onClose={() => setSubFor(null)} bottomInset={insets.bottom} onChanged={loadCounts} />
      <HomeworkPhotoViewer fileId={photo} role="teacher" kind="attachment" onClose={() => setPhoto(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  sub: { color: DARK.sub, fontSize: 12, marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: "#1F6BFF" },
  addTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  fChip: { paddingHorizontal: 14, height: 32, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  fChipOn: { backgroundColor: "#1F6BFF", borderColor: "#1F6BFF" },
  fTxt: { color: DARK.sub, fontSize: 13, fontWeight: "700" },
  strip: { paddingHorizontal: SPACING.md, gap: 8, paddingBottom: 6 },
  dayChip: { width: 56, paddingVertical: 8, borderRadius: 16, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", gap: 2 },
  dayChipOn: { backgroundColor: "#1F6BFF", borderColor: "#1F6BFF" },
  dayName: { color: DARK.sub, fontSize: 11, fontWeight: "700" },
  dayNum: { color: "#fff", fontSize: 17, fontWeight: "800" },
  dayDot: { minWidth: 18, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  dayCnt: { color: "#071B45", fontSize: 10, fontWeight: "800" },
  daySummary: { flexDirection: "row", alignItems: "center", paddingHorizontal: SPACING.lg, paddingTop: 6, paddingBottom: 2, gap: 10 },
  dayTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, height: 32, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.12)" },
  shareTxt: { color: "#fff", fontWeight: "700", fontSize: 12 },
  emptyTxt: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: SPACING.md },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, height: 42, borderRadius: 999, backgroundColor: "#1F6BFF", marginTop: 12 },
  card: { padding: SPACING.md, backgroundColor: DARK.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: DARK.border, gap: 8 },
  subjChip: { alignSelf: "flex-start", paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, marginBottom: 5 },
  subjTxt: { fontSize: 11, fontWeight: "800" },
  cTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  body: { color: "rgba(255,255,255,0.8)", lineHeight: 20, fontSize: 14 },
  thumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: DARK.input },
  badge: { paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  badgeTxt: { fontSize: 11, fontWeight: "800" },
  subsBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 40, borderRadius: 12, backgroundColor: "rgba(31,107,255,0.35)", marginTop: 4 },
  subsTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  newDot: { backgroundColor: "#EF4444", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  newDotTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  meta: { color: DARK.sub, fontSize: 11 },
  fab: { position: "absolute", right: 18, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 18, height: 50, borderRadius: 999, backgroundColor: "#1F6BFF", elevation: 6, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  fabTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
});
