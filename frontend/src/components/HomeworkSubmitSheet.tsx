import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { HomeworkPhotoViewer } from "@/src/components/HomeworkPhotoViewer";
import { dataUri, fmtWhen, HwPhoto, pickHomeworkPhoto } from "@/src/lib/hwFiles";

const MAX = 5;

// Student: send photos of the finished homework to the teacher, and see the teacher's remark / marks afterwards.
export function HomeworkSubmitSheet({ visible, onClose, homework, bottomInset, onChanged }: { visible: boolean; onClose: () => void; homework: any; bottomInset: number; onChanged: () => void }) {
  const [sub, setSub] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [photos, setPhotos] = useState<HwPhoto[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !homework) return;
    setPhotos([]); setNote(""); setErr(""); setSub(null); setLoading(true);
    api(`/student/homework/${homework.id}/submission`).then((r) => setSub(r || null)).catch((e) => setErr(e?.message || "")).finally(() => setLoading(false));
  }, [visible, homework?.id]);

  const add = async (src: "camera" | "gallery") => {
    if (photos.length >= MAX) return Alert.alert("Limit reached", `You can send up to ${MAX} photos.`);
    setUploading(true); setErr("");
    try { const p = await pickHomeworkPhoto(src); if (p) setPhotos((x) => [...x, p]); }
    catch (e: any) { setErr(e?.message || "Could not add this photo."); }
    finally { setUploading(false); }
  };

  const send = async () => {
    if (!photos.length || busy) return;
    setBusy(true); setErr("");
    try {
      await api(`/student/homework/${homework.id}/submit`, { method: "POST", body: { file_ids: photos.map((p) => p.id), note: note.trim() } });
      onChanged(); onClose();
      Alert.alert("Sent to teacher ✓", "Your teacher can now see your homework.");
    } catch (e: any) { setErr(e?.message || "Could not send. Please try again."); }
    finally { setBusy(false); }
  };

  const locked = sub?.status === "reviewed";
  const stat = !sub ? null : sub.status === "reviewed"
    ? { c: "#16A34A", bg: "#DCFCE7", t: "Checked by teacher" }
    : sub.status === "redo" ? { c: "#B45309", bg: "#FEF3C7", t: "Teacher asked you to redo" }
    : { c: "#1F6BFF", bg: "#E0ECFF", t: sub.late ? "Sent (late) - waiting for teacher" : "Sent - waiting for teacher" };

  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={2}>{homework?.title}</Text>
              <Text style={s.sub}>Last date: {homework?.due_date}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable>
          </View>

          {loading ? <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} /> : (
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 560 }}>
              {stat ? (
                <View style={[s.stat, { backgroundColor: stat.bg }]}>
                  <Text style={[s.statTxt, { color: stat.c }]}>{stat.t}</Text>
                  {sub.updated_at ? <Text style={[s.statSub, { color: stat.c }]}>{fmtWhen(sub.updated_at)}</Text> : null}
                </View>
              ) : null}
              {sub?.status === "reviewed" && (sub.marks != null || sub.remark) ? (
                <View style={s.remark}>
                  {sub.marks != null ? <Text style={s.marks}>Marks: {sub.marks}{sub.out_of ? ` / ${sub.out_of}` : ""}</Text> : null}
                  {sub.remark ? <Text style={s.remarkTxt}>{sub.remark}</Text> : null}
                </View>
              ) : null}
              {sub?.status === "redo" && sub.remark ? <View style={[s.remark, { backgroundColor: "#FFFBEB", borderColor: "#FCD34D" }]}><Text style={s.remarkTxt}>{sub.remark}</Text></View> : null}

              {sub?.files?.length ? (
                <>
                  <Text style={s.lbl}>{locked ? "Your photos" : "Photos you sent before"}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 6 }}>
                    {sub.files.map((f: any) => (
                      <Pressable key={f.id} onPress={() => setView(f.id)}><Image source={{ uri: dataUri(f.mime, f.thumb) }} style={s.thumb} /></Pressable>
                    ))}
                  </ScrollView>
                </>
              ) : null}

              {!locked ? (
                <>
                  <Text style={s.lbl}>{sub ? "Send again (replaces earlier photos)" : "Add photos of your homework"}</Text>
                  <View style={s.addRow}>
                    <Pressable onPress={() => add("camera")} disabled={uploading} style={s.addBtn} testID="hw-add-camera"><Ionicons name="camera" size={18} color="#1F6BFF" /><Text style={s.addTxt}>Camera</Text></Pressable>
                    <Pressable onPress={() => add("gallery")} disabled={uploading} style={s.addBtn} testID="hw-add-gallery"><Ionicons name="image" size={18} color="#1F6BFF" /><Text style={s.addTxt}>Gallery</Text></Pressable>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
                    {photos.map((p) => (
                      <View key={p.id}>
                        <Image source={{ uri: p.preview }} style={s.thumb} />
                        <Pressable onPress={() => setPhotos((x) => x.filter((y) => y.id !== p.id))} style={s.rm} hitSlop={6}><Ionicons name="close-circle" size={22} color="#DC2626" /></Pressable>
                      </View>
                    ))}
                    {uploading ? <View style={[s.thumb, { alignItems: "center", justifyContent: "center", backgroundColor: "#EEF4FF" }]}><ActivityIndicator color="#1F6BFF" /></View> : null}
                  </ScrollView>
                  <Text style={s.hint}>Tip: keep the page flat, in good light, and make the writing clear.</Text>
                  <TextInput value={note} onChangeText={setNote} placeholder="Message for teacher (optional)" placeholderTextColor="#94A3B8" multiline style={s.input} maxLength={500} />
                  {err ? <Text style={s.err}>{err}</Text> : null}
                  <Pressable onPress={send} disabled={!photos.length || busy} style={[s.go, (!photos.length || busy) && { opacity: 0.45 }]} testID="hw-send">
                    {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={17} color="#fff" /><Text style={s.goTxt}>{sub ? "Send again" : "Send to teacher"}</Text></>}
                  </Pressable>
                </>
              ) : <Text style={s.hint}>This homework is checked. If you need to send it again, ask your teacher to send it back.</Text>}
            </ScrollView>
          )}
        </View>
      </View>
      <HomeworkPhotoViewer fileId={view} role="student" onClose={() => setView(null)} />
    </InlineOverlay>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  stat: { borderRadius: 12, padding: 12, marginTop: 4 },
  statTxt: { fontWeight: "800", fontSize: 14 },
  statSub: { fontSize: 11, marginTop: 2, opacity: 0.8 },
  remark: { backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", borderRadius: 12, padding: 12, marginTop: 8, gap: 4 },
  marks: { fontWeight: "900", fontSize: 18, color: "#15803D" },
  remarkTxt: { color: "#0F172A", fontSize: 14, lineHeight: 20 },
  lbl: { color: "#1F6BFF", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14 },
  addRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  addBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12, borderWidth: 1.5, borderColor: "#BFD7FF" },
  addTxt: { color: "#1F6BFF", fontWeight: "800", fontSize: 14 },
  thumb: { width: 76, height: 76, borderRadius: 10, backgroundColor: "#E2E8F0" },
  rm: { position: "absolute", top: -6, right: -6, backgroundColor: "#fff", borderRadius: 11 },
  hint: { color: "#64748B", fontSize: 12, lineHeight: 17, marginTop: 6 },
  input: { backgroundColor: "#F4F8FF", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#0F172A", marginTop: 10, minHeight: 56, textAlignVertical: "top" },
  err: { color: "#B91C1C", fontSize: 13, marginTop: 8 },
  go: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, backgroundColor: "#1F6BFF", marginTop: 12 },
  goTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
