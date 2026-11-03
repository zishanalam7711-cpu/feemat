import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { AudiencePicker, Audience, EVERYONE, audienceBody, audienceValid } from "@/src/components/AudiencePicker";
import { addDaysYmd, dayLabel, HwPhoto, localToday, pickTeacherHomeworkPhoto } from "@/src/lib/hwFiles";

const D = { card: "#0E2A63", border: "rgba(255,255,255,0.08)", sub: "rgba(255,255,255,0.6)", input: "rgba(255,255,255,0.07)", brand: "#1F6BFF" };
const SUBJECTS = ["Maths", "Science", "English", "Hindi", "SST", "Computer", "GK", "Other"];
const MAX_PHOTOS = 5;

// Teacher: a proper "New homework" form - subject, title, long details, photos, date, last date, audience.
export function HomeworkComposer({ visible, onClose, classes, batches, students, bottomInset, defaultDate, onCreated, onNeedPro }: {
  visible: boolean; onClose: () => void; classes: any[]; batches: any[]; students: any[]; bottomInset: number; defaultDate: string; onCreated: () => void; onNeedPro: () => void;
}) {
  const today = localToday();
  const [subject, setSubject] = useState("");
  const [custom, setCustom] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [photos, setPhotos] = useState<HwPhoto[]>([]);
  const [date, setDate] = useState(defaultDate || today);
  const [due, setDue] = useState(addDaysYmd(defaultDate || today, 1));
  const [aud, setAud] = useState<Audience>(EVERYONE);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");

  // every time the sheet opens, start fresh for the selected day
  useEffect(() => {
    if (!visible) return;
    const d = defaultDate || today;
    setSubject(""); setCustom(""); setTitle(""); setDesc(""); setPhotos([]); setErr(""); setDate(d); setDue(addDaysYmd(d, 1)); setAud(EVERYONE);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const addPhoto = async (src: "camera" | "gallery") => {
    if (photos.length >= MAX_PHOTOS) return Alert.alert("Limit reached", `You can attach up to ${MAX_PHOTOS} photos.`);
    setUploading(true); setErr("");
    try { const p = await pickTeacherHomeworkPhoto(src); if (p) setPhotos((x) => [...x, p]); }
    catch (e: any) { setErr(e?.message || "Could not add this photo."); }
    finally { setUploading(false); }
  };

  const subjectName = subject === "Other" ? custom.trim() : subject;

  const send = async () => {
    setErr("");
    if (!title.trim()) return setErr("Write a title for the homework.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return setErr("Dates must look like 2026-10-24.");
    if (due < date) return setErr("The last date cannot be before the homework date.");
    if (!audienceValid(aud)) return setErr("Choose who this homework is for (a class, batch or students).");
    setBusy(true);
    try {
      await api("/teacher/homework", { method: "POST", body: {
        title: title.trim(), description: desc.trim(), subject: subjectName, assigned_date: date, due_date: due,
        attachment_ids: photos.map((p) => p.id), ...audienceBody(aud),
      } });
      onCreated();
      Alert.alert("Homework sent ✓", "Students will get a notification.", [
        { text: "Add another subject", onPress: () => { setSubject(""); setCustom(""); setTitle(""); setDesc(""); setPhotos([]); } },
        { text: "Done", style: "cancel", onPress: onClose },
      ]);
    } catch (e: any) {
      if (String(e?.message || "").includes("Upgrade to Pro")) { onClose(); onNeedPro(); }
      else setErr(e?.message || "Could not send the homework.");
    } finally { setBusy(false); }
  };

  const dateChips: [string, string][] = [["Yesterday", addDaysYmd(today, -1)], ["Today", today], ["Tomorrow", addDaysYmd(today, 1)]];
  if (!dateChips.some(([, v]) => v === date)) dateChips.push([dayLabel(date, today), date]);

  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}>
            <Text style={s.title}>New homework</Text>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color={D.sub} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={s.label}>Subject</Text>
            <View style={s.wrap}>
              {SUBJECTS.map((x) => (
                <Pressable key={x} onPress={() => setSubject(subject === x ? "" : x)} style={[s.chip, subject === x && s.chipOn]} testID={`hw-subject-${x}`}>
                  <Text style={[s.chipTxt, subject === x && { color: "#fff" }]}>{x}</Text>
                </Pressable>
              ))}
            </View>
            {subject === "Other" ? <TextInput value={custom} onChangeText={setCustom} placeholder="Subject name" placeholderTextColor="rgba(255,255,255,0.35)" style={[s.input, { marginTop: 8 }]} maxLength={60} /> : null}

            <Text style={s.label}>Title</Text>
            <TextInput testID="hw-title" value={title} onChangeText={setTitle} placeholder="e.g. Chapter 5 - fractions" placeholderTextColor="rgba(255,255,255,0.35)" style={s.input} maxLength={200} />

            <Text style={s.label}>Details (what to do)</Text>
            <TextInput testID="hw-desc" value={desc} onChangeText={setDesc} multiline maxLength={2000}
              placeholder={"Write everything here, for example:\n1. Q1 to Q10 from page 42\n2. Learn the table of 14\n3. Draw the diagram of a flower"}
              placeholderTextColor="rgba(255,255,255,0.35)" style={[s.input, { minHeight: 150, textAlignVertical: "top", paddingTop: 12 }]} />
            <Text style={s.count}>{desc.length}/2000</Text>

            <Text style={s.label}>Photos (worksheet / board / book page)</Text>
            <View style={s.addRow}>
              <Pressable onPress={() => addPhoto("camera")} disabled={uploading} style={s.addBtn} testID="hw-photo-camera"><Ionicons name="camera" size={18} color="#fff" /><Text style={s.addTxt}>Camera</Text></Pressable>
              <Pressable onPress={() => addPhoto("gallery")} disabled={uploading} style={s.addBtn} testID="hw-photo-gallery"><Ionicons name="image" size={18} color="#fff" /><Text style={s.addTxt}>Gallery</Text></Pressable>
            </View>
            {photos.length || uploading ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
                {photos.map((p) => (
                  <View key={p.id}>
                    <Image source={{ uri: p.preview }} style={s.thumb} />
                    <Pressable onPress={() => setPhotos((x) => x.filter((y) => y.id !== p.id))} style={s.rm} hitSlop={6}><Ionicons name="close-circle" size={22} color="#F87171" /></Pressable>
                  </View>
                ))}
                {uploading ? <View style={[s.thumb, { alignItems: "center", justifyContent: "center", backgroundColor: D.input }]}><ActivityIndicator color="#35A7FF" /></View> : null}
              </ScrollView>
            ) : null}

            <Text style={s.label}>Homework for the day</Text>
            <View style={s.wrap}>
              {dateChips.map(([l, v]) => (
                <Pressable key={v} onPress={() => { setDate(v); if (due < v) setDue(addDaysYmd(v, 1)); }} style={[s.chip, date === v && s.chipOn]}>
                  <Text style={[s.chipTxt, date === v && { color: "#fff" }]}>{l}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Last date to finish</Text>
            <TextInput testID="hw-due" value={due} onChangeText={setDue} placeholder="YYYY-MM-DD" placeholderTextColor="rgba(255,255,255,0.35)" style={s.input} />
            <View style={s.wrap}>
              {([["Next day", 1], ["3 days", 3], ["1 week", 7], ["2 weeks", 14]] as [string, number][]).map(([l, n]) => {
                const v = addDaysYmd(date, n);
                return (
                  <Pressable key={l} onPress={() => setDue(v)} style={[s.chip, due === v && s.chipOn]}>
                    <Text style={[s.chipTxt, due === v && { color: "#fff" }]}>{l}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={{ marginTop: 18 }}>
              <AudiencePicker classes={classes} batches={batches} students={students} value={aud} onChange={setAud} />
            </View>

            {err ? <Text style={s.err}>{err}</Text> : null}
            <Pressable testID="hw-save" onPress={send} disabled={busy || uploading} style={[s.save, (busy || uploading) && { opacity: 0.6 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={17} color="#fff" /><Text style={s.saveTxt}>Send homework to students</Text></>}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </InlineOverlay>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: D.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, maxHeight: "94%" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  label: { color: D.sub, fontSize: 12, fontWeight: "700", marginTop: 16, marginBottom: 6, textTransform: "uppercase" },
  input: { minHeight: 46, borderRadius: 14, backgroundColor: D.input, color: "#fff", paddingHorizontal: 14, fontSize: 15, borderWidth: 1, borderColor: D.border },
  count: { color: D.sub, fontSize: 11, textAlign: "right", marginTop: 4 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 13, height: 34, borderRadius: 999, backgroundColor: D.input, borderWidth: 1, borderColor: D.border, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: D.brand, borderColor: D.brand },
  chipTxt: { color: D.sub, fontSize: 13, fontWeight: "700" },
  addRow: { flexDirection: "row", gap: 8 },
  addBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 14, backgroundColor: "rgba(31,107,255,0.35)" },
  addTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  thumb: { width: 76, height: 76, borderRadius: 12, backgroundColor: D.input },
  rm: { position: "absolute", top: -6, right: -6, backgroundColor: D.card, borderRadius: 11 },
  err: { color: "#FCA5A5", fontSize: 13, marginTop: 12 },
  save: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: 14, backgroundColor: D.brand, marginTop: 16 },
  saveTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
