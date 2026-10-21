import React, { useCallback, useMemo, useState } from "react";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, TextInput, Alert,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { ProUpgradeModal } from "@/src/components/ProUpgradeModal";
import {
  AudiencePicker, Audience, EVERYONE, audienceBody, audienceLabel, audienceValid,
} from "@/src/components/AudiencePicker";

const DARK = {
  bg: "#120A28",
  card: "#1E1440",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  input: "rgba(255,255,255,0.07)",
};

const todayStr = () => new Date().toISOString().slice(0, 10);
function addDays(d: string, n: number) {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function daysLeft(due: string) {
  const a = new Date(due + "T00:00:00Z").getTime();
  const b = new Date(todayStr() + "T00:00:00Z").getTime();
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

type Filter = "upcoming" | "past" | "all";

export default function Homework() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("upcoming");
  const [show, setShow] = useState(false);
  const [pro, setPro] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [due, setDue] = useState(addDays(todayStr(), 3));
  const [aud, setAud] = useState<Audience>(EVERYONE);

  const load = useCallback(async () => {
    try {
      const [h, c, b, s]: any = await Promise.all([
        api("/teacher/homework"),
        api("/teacher/classes").catch(() => []),
        api("/teacher/batches").catch(() => []),
        api("/teacher/students?filter=all&limit=200").catch(() => ({ items: [] })),
      ]);
      setItems(h || []); setClasses(c || []); setBatches(b || []); setStudents(s.items || []);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const list = useMemo(() => {
    const t = todayStr();
    const up = items.filter((h) => h.due_date >= t).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    const past = items.filter((h) => h.due_date < t).sort((a, b) => (a.due_date < b.due_date ? 1 : -1));
    return filter === "upcoming" ? up : filter === "past" ? past : [...up, ...past];
  }, [items, filter]);

  const upcomingCount = useMemo(() => items.filter((h) => h.due_date >= todayStr()).length, [items]);

  const reset = () => { setTitle(""); setDesc(""); setDue(addDays(todayStr(), 3)); setAud(EVERYONE); };

  const create = async () => {
    if (!title.trim()) { Alert.alert("Enter a title", "Enter the homework title."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) { Alert.alert("Invalid date", "Enter the date as YYYY-MM-DD."); return; }
    if (!audienceValid(aud)) { Alert.alert("Who is this for?", "Choose a class, batch or students."); return; }
    setBusy(true);
    try {
      await api("/teacher/homework", { method: "POST", body: { title: title.trim(), description: desc.trim(), due_date: due, ...audienceBody(aud) } });
      setShow(false); reset();
      await load();
    } catch (e: any) {
      if (String(e?.message || "").includes("Upgrade to Pro")) { setShow(false); setPro(true); }
      else Alert.alert("Error", e?.message || "Could not assign the homework.");
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Homework</Text>
          <Text style={styles.sub}>{upcomingCount} active</Text>
        </View>
        <Pressable testID="new-hw" onPress={() => setShow(true)} style={styles.addBtn}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addTxt}>New</Text>
        </Pressable>
      </View>

      <View style={styles.filters}>
        {([["upcoming", "Active"], ["past", "Past"], ["all", "All"]] as [Filter, string][]).map(([k, l]) => (
          <Pressable key={k} onPress={() => setFilter(k)} style={[styles.fChip, filter === k && styles.fChipOn]}>
            <Text style={[styles.fTxt, filter === k && { color: "#fff" }]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#A855F7" /></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="clipboard-outline" size={56} color="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTxt}>{filter === "past" ? "No past homework" : "No homework yet"}</Text>
          <Text style={{ color: DARK.sub }}>Tap "New" above to assign homework.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
          {list.map((h) => {
            const b = dueBadge(h.due_date);
            return (
              <View key={h.id} style={styles.card}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: SPACING.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cTitle}>{h.title}</Text>
                    {h.description ? <Text style={styles.body}>{h.description}</Text> : null}
                  </View>
                  <View style={[styles.badge, { backgroundColor: b.color + "26" }]}>
                    <Text style={[styles.badgeTxt, { color: b.color }]}>{b.txt}</Text>
                  </View>
                </View>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar" size={12} color={DARK.sub} />
                  <Text style={styles.meta}>Last date: {h.due_date}</Text>
                  <Text style={styles.meta}>•</Text>
                  <Ionicons name="people" size={12} color={DARK.sub} />
                  <Text style={styles.meta}>{audienceLabel(h, classes, batches)}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      <InlineOverlay visible={show} onClose={() => setShow(false)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShow(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.lg }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>New Homework</Text>

              <Text style={styles.label}>Title</Text>
              <TextInput testID="hw-title" value={title} onChangeText={setTitle} placeholder="e.g. Chapter 5 questions" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />

              <Text style={styles.label}>Details</Text>
              <TextInput
                testID="hw-desc" value={desc} onChangeText={setDesc} multiline placeholder="Describe what to do"
                placeholderTextColor="rgba(255,255,255,0.35)" style={[styles.input, { minHeight: 90, textAlignVertical: "top", paddingTop: 12 }]}
              />

              <Text style={styles.label}>Last date</Text>
              <TextInput testID="hw-due" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
              <View style={styles.wrap}>
                {([["Tomorrow", 1], ["3 days", 3], ["1 week", 7], ["2 weeks", 14]] as [string, number][]).map(([l, n]) => {
                  const v = addDays(todayStr(), n);
                  return (
                    <Pressable key={l} onPress={() => setDue(v)} style={[styles.chip, due === v && styles.chipOn]}>
                      <Text style={[styles.chipTxt, due === v && { color: "#fff" }]}>{l}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ marginTop: SPACING.lg }}>
                <AudiencePicker classes={classes} batches={batches} students={students} value={aud} onChange={setAud} />
              </View>

              <Pressable testID="hw-save" onPress={create} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Assign Homework</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </InlineOverlay>
      <ProUpgradeModal visible={pro} onClose={() => setPro(false)} feature="Homework" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  sub: { color: DARK.sub, fontSize: 12, marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: "#7C3AED" },
  addTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  filters: { flexDirection: "row", gap: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  fChip: { paddingHorizontal: 14, height: 32, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  fChipOn: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  fTxt: { color: DARK.sub, fontSize: 13, fontWeight: "700" },
  emptyTxt: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: SPACING.md },
  card: { padding: SPACING.md, backgroundColor: DARK.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: DARK.border, gap: 8 },
  cTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  body: { color: "rgba(255,255,255,0.75)", lineHeight: 19, marginTop: 4 },
  badge: { paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  badgeTxt: { fontSize: 11, fontWeight: "800" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  meta: { color: DARK.sub, fontSize: 11 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, maxHeight: "92%" },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  label: { color: DARK.sub, fontSize: 12, fontWeight: "700", marginTop: SPACING.md, marginBottom: 6, textTransform: "uppercase" },
  input: { minHeight: 46, borderRadius: RADIUS.md, backgroundColor: DARK.input, color: "#fff", paddingHorizontal: SPACING.md, fontSize: 15, borderWidth: 1, borderColor: DARK.border },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: SPACING.sm },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  chipTxt: { color: DARK.sub, fontSize: 13, fontWeight: "600" },
  saveBtn: { height: 50, borderRadius: RADIUS.md, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center", marginTop: SPACING.xl },
  saveTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
