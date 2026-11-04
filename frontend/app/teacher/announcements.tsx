import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Image, Switch } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { ProUpgradeModal } from "@/src/components/ProUpgradeModal";
import { HomeworkPhotoViewer } from "@/src/components/HomeworkPhotoViewer";
import { AudiencePicker, Audience, EVERYONE, audienceBody, audienceLabel, audienceValid } from "@/src/components/AudiencePicker";
import { dataUri, fmtWhen, HwPhoto, pickTeacherHomeworkPhoto } from "@/src/lib/hwFiles";

const DARK = { bg: "#071B45", card: "#0E2A63", border: "rgba(255,255,255,0.08)", sub: "rgba(255,255,255,0.6)", input: "rgba(255,255,255,0.07)" };
const CATS = [
  { k: "Notice", emoji: "📢", color: "#35A7FF", tpl: "" },
  { k: "Holiday", emoji: "🏖️", color: "#10B981", tpl: "Classes will be closed tomorrow. The next class will be at the regular time." },
  { k: "Exam", emoji: "📝", color: "#F59E0B", tpl: "Test date and syllabus:\n" },
  { k: "Fee", emoji: "💰", color: "#EC4899", tpl: "This is a reminder to pay this month's fees." },
  { k: "Event", emoji: "🎉", color: "#A78BFA", tpl: "" },
  { k: "Other", emoji: "📌", color: "#94A3B8", tpl: "" },
];
const catOf = (k: string) => CATS.find((c) => c.k === k) || CATS[0];

export default function Announcements() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [cat, setCat] = useState("Notice");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [important, setImportant] = useState(false);
  const [photos, setPhotos] = useState<HwPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [aud, setAud] = useState<Audience>(EVERYONE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pro, setPro] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, c, b, s]: any = await Promise.all([
        api("/teacher/announcements"), api("/teacher/classes").catch(() => []), api("/teacher/batches").catch(() => []),
        api("/teacher/students?filter=all&limit=200").catch(() => ({ items: [] })),
      ]);
      setItems(a || []); setClasses(c || []); setBatches(b || []); setStudents(s.items || []);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = () => { setCat("Notice"); setTitle(""); setBody(""); setImportant(false); setPhotos([]); setAud(EVERYONE); setErr(""); setShow(true); };
  const pickCat = (k: string) => { setCat(k); const c = catOf(k); if (!body.trim() && c.tpl) setBody(c.tpl); };

  const addPhoto = async (src: "camera" | "gallery") => {
    if (photos.length >= 5) return Alert.alert("Limit reached", "You can attach up to 5 photos.");
    setUploading(true); setErr("");
    try { const p = await pickTeacherHomeworkPhoto(src); if (p) setPhotos((x) => [...x, p]); } catch (e: any) { setErr(e?.message || "Could not add this photo."); }
    setUploading(false);
  };

  const send = async () => {
    setErr("");
    if (!title.trim()) return setErr("Write a title.");
    if (!body.trim() && !photos.length) return setErr("Write the details or add a photo.");
    if (!audienceValid(aud)) return setErr("Choose who should receive this (a class, batch or students).");
    setBusy(true);
    try {
      await api("/teacher/announcements", { method: "POST", body: { title: title.trim(), body: body.trim(), category: cat, important, attachment_ids: photos.map((p) => p.id), ...audienceBody(aud) } });
      setShow(false); await load();
    } catch (e: any) {
      if (String(e?.message || "").includes("Upgrade to Pro")) { setShow(false); setPro(true); } else setErr(e?.message || "Could not send the notice.");
    } finally { setBusy(false); }
  };

  const remove = (a: any) => Alert.alert("Delete this notice?", `"${a.title}" will be removed for the students too.`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { try { await api(`/teacher/announcements/${a.id}`, { method: "DELETE" }); await load(); } catch (e: any) { Alert.alert("Could not delete", e?.message || ""); } } },
  ]);

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1 }}><Text style={styles.title}>Announcements</Text><Text style={styles.sub}>{items.length} notice{items.length === 1 ? "" : "s"}</Text></View>
        <Pressable testID="new-ann" onPress={openNew} style={styles.addBtn}><Ionicons name="add" size={18} color="#fff" /><Text style={styles.addTxt}>New</Text></Pressable>
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator color="#35A7FF" /></View> : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="megaphone-outline" size={56} color="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTxt}>No announcements yet</Text>
          <Pressable onPress={openNew} style={styles.emptyBtn}><Ionicons name="add" size={18} color="#fff" /><Text style={styles.addTxt}>Send a notice</Text></Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: 120 }}>
          {items.map((a) => {
            const c = catOf(a.category);
            return (
              <View key={a.id} style={[styles.card, a.important && { borderColor: "#F59E0B" }]}>
                <View style={styles.rowTop}>
                  <View style={[styles.catChip, { backgroundColor: c.color + "26" }]}><Text style={[styles.catTxt, { color: c.color }]}>{c.emoji} {c.k}</Text></View>
                  {a.important ? <View style={styles.pin}><Ionicons name="pin" size={12} color="#F59E0B" /><Text style={styles.pinTxt}>Important</Text></View> : null}
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={() => remove(a)} hitSlop={10}><Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.45)" /></Pressable>
                </View>
                <Text style={styles.cTitle}>{a.title}</Text>
                {a.body ? <Text style={styles.body}>{a.body}</Text> : null}
                {a.attachments?.length ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {a.attachments.map((p: any) => (
                      <Pressable key={p.id} onPress={() => setPhoto(p.id)}>
                        {p.thumb ? <Image source={{ uri: dataUri(p.mime, p.thumb) }} style={styles.thumb} /> : <View style={[styles.thumb, { alignItems: "center", justifyContent: "center" }]}><Ionicons name="image" size={22} color={DARK.sub} /></View>}
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
                <View style={styles.metaRow}>
                  <Ionicons name="people" size={12} color={DARK.sub} /><Text style={styles.meta}>{audienceLabel(a, classes, batches)}</Text>
                  <Text style={styles.meta}>•  {fmtWhen(a.created_at)}</Text>
                </View>
                <View style={styles.seen}><Ionicons name="eye" size={14} color="#35A7FF" /><Text style={styles.seenTxt}>Seen by {a.read_count ?? 0}{a.total != null ? ` of ${a.total}` : ""}</Text></View>
              </View>
            );
          })}
        </ScrollView>
      )}

      <InlineOverlay visible={show} onClose={() => setShow(false)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShow(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHead}><Text style={styles.sheetTitle}>New announcement</Text><Pressable onPress={() => setShow(false)} hitSlop={10}><Ionicons name="close" size={24} color={DARK.sub} /></Pressable></View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Type</Text>
              <View style={styles.wrap}>{CATS.map((c) => (
                <Pressable key={c.k} onPress={() => pickCat(c.k)} style={[styles.chip, cat === c.k && { backgroundColor: c.color, borderColor: c.color }]}>
                  <Text style={[styles.chipTxt, cat === c.k && { color: "#fff" }]}>{c.emoji} {c.k}</Text>
                </Pressable>))}</View>

              <Text style={styles.label}>Title</Text>
              <TextInput testID="ann-title" value={title} onChangeText={setTitle} placeholder="e.g. Holiday on Friday" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} maxLength={120} />
              <Text style={styles.label}>Details</Text>
              <TextInput testID="ann-body" value={body} onChangeText={setBody} multiline maxLength={2000} placeholder="Write the full message here" placeholderTextColor="rgba(255,255,255,0.35)" style={[styles.input, { minHeight: 130, textAlignVertical: "top", paddingTop: 12 }]} />
              <Text style={styles.count}>{body.length}/2000</Text>

              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}><Text style={styles.switchTitle}>Mark as important</Text><Text style={styles.switchSub}>Stays at the top for students and shows 📌</Text></View>
                <Switch value={important} onValueChange={setImportant} />
              </View>

              <Text style={styles.label}>Photos (optional)</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable onPress={() => addPhoto("camera")} disabled={uploading} style={styles.addPhoto}><Ionicons name="camera" size={18} color="#fff" /><Text style={styles.addTxt}>Camera</Text></Pressable>
                <Pressable onPress={() => addPhoto("gallery")} disabled={uploading} style={styles.addPhoto}><Ionicons name="image" size={18} color="#fff" /><Text style={styles.addTxt}>Gallery</Text></Pressable>
              </View>
              {photos.length || uploading ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
                  {photos.map((p) => (<View key={p.id}><Image source={{ uri: p.preview }} style={styles.thumb} />
                    <Pressable onPress={() => setPhotos((x) => x.filter((y) => y.id !== p.id))} style={styles.rm} hitSlop={6}><Ionicons name="close-circle" size={22} color="#F87171" /></Pressable></View>))}
                  {uploading ? <View style={[styles.thumb, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color="#35A7FF" /></View> : null}
                </ScrollView>
              ) : null}

              <View style={{ marginTop: 16 }}><AudiencePicker classes={classes} batches={batches} students={students} value={aud} onChange={setAud} /></View>
              {err ? <Text style={styles.err}>{err}</Text> : null}
              <Pressable testID="ann-send" onPress={send} disabled={busy || uploading} style={[styles.send, (busy || uploading) && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={17} color="#fff" /><Text style={styles.sendTxt}>Send to students</Text></>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </InlineOverlay>
      <ProUpgradeModal visible={pro} onClose={() => setPro(false)} feature="Announcements" />
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
  emptyTxt: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: SPACING.md },
  emptyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, height: 42, borderRadius: 999, backgroundColor: "#1F6BFF", marginTop: 12 },
  card: { padding: SPACING.md, backgroundColor: DARK.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: DARK.border, gap: 8 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  catChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  catTxt: { fontSize: 11.5, fontWeight: "800" },
  pin: { flexDirection: "row", alignItems: "center", gap: 3 },
  pinTxt: { color: "#F59E0B", fontSize: 11, fontWeight: "800" },
  cTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  body: { color: "rgba(255,255,255,0.8)", lineHeight: 20, fontSize: 14 },
  thumb: { width: 84, height: 84, borderRadius: 12, backgroundColor: DARK.input },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  meta: { color: DARK.sub, fontSize: 11 },
  seen: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(53,167,255,0.12)", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  seenTxt: { color: "#35A7FF", fontSize: 12, fontWeight: "800" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, maxHeight: "94%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  label: { color: DARK.sub, fontSize: 12, fontWeight: "700", marginTop: 16, marginBottom: 6, textTransform: "uppercase" },
  input: { minHeight: 46, borderRadius: 14, backgroundColor: DARK.input, color: "#fff", paddingHorizontal: 14, fontSize: 15, borderWidth: 1, borderColor: DARK.border },
  count: { color: DARK.sub, fontSize: 11, textAlign: "right", marginTop: 4 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 13, height: 34, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  chipTxt: { color: DARK.sub, fontSize: 13, fontWeight: "700" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 16, backgroundColor: DARK.input, borderRadius: 14, padding: 12 },
  switchTitle: { color: "#fff", fontWeight: "800", fontSize: 14 },
  switchSub: { color: DARK.sub, fontSize: 11.5, marginTop: 2 },
  addPhoto: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 14, backgroundColor: "rgba(31,107,255,0.35)" },
  rm: { position: "absolute", top: -6, right: -6, backgroundColor: DARK.card, borderRadius: 11 },
  err: { color: "#FCA5A5", fontSize: 13, marginTop: 12 },
  send: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 14, backgroundColor: "#1F6BFF", marginTop: 16 },
  sendTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
