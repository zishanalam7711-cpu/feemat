import React, { useCallback, useState } from "react";
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

const CATEGORIES = [
  { k: "notice", emoji: "📢", label: "Notice", tpl: "" },
  { k: "holiday", emoji: "🏖️", label: "Holiday", tpl: "Classes will be closed tomorrow. The next class will be at the regular time." },
  { k: "exam", emoji: "📝", label: "Exam", tpl: "Test date and syllabus: " },
  { k: "fee", emoji: "💰", label: "Fee", tpl: "This is a reminder to pay this month's fees." },
  { k: "timing", emoji: "⏰", label: "Timing", tpl: "New class timing: " },
];

export default function Announcements() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [cat, setCat] = useState(CATEGORIES[0]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [aud, setAud] = useState<Audience>(EVERYONE);
  const [busy, setBusy] = useState(false);
  const [pro, setPro] = useState(false);

  const load = useCallback(async () => {
    try {
      const [a, c, b, s]: any = await Promise.all([
        api("/teacher/announcements"),
        api("/teacher/classes").catch(() => []),
        api("/teacher/batches").catch(() => []),
        api("/teacher/students?filter=all&limit=200").catch(() => ({ items: [] })),
      ]);
      setItems(a || []); setClasses(c || []); setBatches(b || []); setStudents(s.items || []);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickCat = (c: typeof CATEGORIES[number]) => {
    // body khali ho ya purana template ho to naya template bhar do
    if (body.trim() === "" || body === cat.tpl) setBody(c.tpl);
    setCat(c);
  };

  const reset = () => { setTitle(""); setBody(""); setCat(CATEGORIES[0]); setAud(EVERYONE); };

  const create = async () => {
    if (!title.trim()) { Alert.alert("Enter a title", "Enter the announcement title."); return; }
    if (!audienceValid(aud)) { Alert.alert("Who should receive this?", "Choose a class, batch or students."); return; }
    setBusy(true);
    try {
      await api("/teacher/announcements", {
        method: "POST",
        body: { title: `${cat.emoji} ${title.trim()}`, body: body.trim(), ...audienceBody(aud) },
      });
      setShow(false); reset();
      await load();
    } catch (e: any) {
      if (String(e?.message || "").includes("Upgrade to Pro")) { setShow(false); setPro(true); }
      else Alert.alert("Error", e?.message || "Could not send the announcement.");
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={styles.title}>Announcements</Text>
        <Pressable testID="new-ann" onPress={() => setShow(true)} style={styles.addBtn}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addTxt}>New</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#A855F7" /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="megaphone-outline" size={56} color="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTxt}>No announcements yet</Text>
          <Text style={{ color: DARK.sub }}>Send a holiday, exam or fee notice.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
          {items.map((a) => (
            <View key={a.id} style={styles.card}>
              <Text style={styles.cTitle}>{a.title}</Text>
              {a.body ? <Text style={styles.body}>{a.body}</Text> : null}
              <View style={styles.metaRow}>
                <Ionicons name="people" size={12} color={DARK.sub} />
                <Text style={styles.meta}>{audienceLabel(a, classes, batches)}</Text>
                <Text style={styles.meta}>•</Text>
                <Text style={styles.meta}>{new Date(a.created_at).toLocaleString()}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <InlineOverlay visible={show} onClose={() => setShow(false)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShow(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.lg }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>New Announcement</Text>

              <Text style={styles.label}>Type</Text>
              <View style={styles.wrap}>
                {CATEGORIES.map((c) => {
                  const on = cat.k === c.k;
                  return (
                    <Pressable key={c.k} onPress={() => pickCat(c)} style={[styles.chip, on && styles.chipOn]}>
                      <Text style={[styles.chipTxt, on && { color: "#fff" }]}>{c.emoji} {c.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.label}>Title</Text>
              <TextInput testID="a-title" value={title} onChangeText={setTitle} placeholder="e.g. Holiday tomorrow" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />

              <Text style={styles.label}>Message</Text>
              <TextInput
                testID="a-body" value={body} onChangeText={setBody} multiline placeholder="Write the full message"
                placeholderTextColor="rgba(255,255,255,0.35)" style={[styles.input, { minHeight: 100, textAlignVertical: "top", paddingTop: 12 }]}
              />

              <View style={{ marginTop: SPACING.lg }}>
                <AudiencePicker classes={classes} batches={batches} students={students} value={aud} onChange={setAud} />
              </View>

              <Pressable testID="a-save" onPress={create} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Send</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </InlineOverlay>
      <ProUpgradeModal visible={pro} onClose={() => setPro(false)} feature="Announcements" />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  title: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "800" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: "#7C3AED" },
  addTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  emptyTxt: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: SPACING.md },
  card: { padding: SPACING.md, backgroundColor: DARK.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: DARK.border, gap: 6 },
  cTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  body: { color: "rgba(255,255,255,0.8)", lineHeight: 19 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
  meta: { color: DARK.sub, fontSize: 11 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, maxHeight: "92%" },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  label: { color: DARK.sub, fontSize: 12, fontWeight: "700", marginTop: SPACING.md, marginBottom: 6, textTransform: "uppercase" },
  input: { minHeight: 46, borderRadius: RADIUS.md, backgroundColor: DARK.input, color: "#fff", paddingHorizontal: SPACING.md, fontSize: 15, borderWidth: 1, borderColor: DARK.border },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  chipTxt: { color: DARK.sub, fontSize: 13, fontWeight: "600" },
  saveBtn: { height: 50, borderRadius: RADIUS.md, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center", marginTop: SPACING.xl },
  saveTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
