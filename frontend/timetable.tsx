import React, { useCallback, useMemo, useState } from "react";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

const DARK = {
  bg: "#071B45",
  card: "#0E2A63",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  input: "rgba(255,255,255,0.07)",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const todayIdx = () => (new Date().getDay() + 6) % 7; // Monday = 0

export function fmt12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}
function addMinutes(hhmm: string, mins: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const t = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

export default function TeacherTimetable() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState(todayIdx());

  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [subject, setSubject] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState("16:00");
  const [end, setEnd] = useState("17:00");
  const [classId, setClassId] = useState<string | undefined>();
  const [batchId, setBatchId] = useState<string | undefined>();
  const [room, setRoom] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, c, b, s]: any = await Promise.all([
        api("/teacher/timetable"),
        api("/teacher/classes").catch(() => []),
        api("/teacher/batches").catch(() => []),
        api("/teacher/subjects").catch(() => []),
      ]);
      setItems(t || []); setClasses(c || []); setBatches(b || []); setSubjects(s || []);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const counts = useMemo(() => {
    const c = [0, 0, 0, 0, 0, 0, 0];
    items.forEach((e) => { c[e.day] += 1; });
    return c;
  }, [items]);
  const list = items.filter((e) => e.day === day);

  const nameOf = (e: any) => {
    const parts: string[] = [];
    if (e.class_id) parts.push(classes.find((c) => c.id === e.class_id)?.name || "Class");
    if (e.batch_id) parts.push(batches.find((b) => b.id === e.batch_id)?.name || "Batch");
    return parts.length ? parts.join(" • ") : "All students";
  };

  const openNew = () => {
    setEditing(null); setSubject(""); setDays([day]); setStart("16:00"); setEnd("17:00");
    setClassId(undefined); setBatchId(undefined); setRoom(""); setNote(""); setShow(true);
  };
  const openEdit = (e: any) => {
    setEditing(e); setSubject(e.subject); setDays([e.day]); setStart(e.start); setEnd(e.end);
    setClassId(e.class_id || undefined); setBatchId(e.batch_id || undefined); setRoom(e.room || ""); setNote(e.note || ""); setShow(true);
  };

  const toggleDay = (d: number) => {
    if (editing) { setDays([d]); return; }
    setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  };

  const save = async () => {
    if (!subject.trim()) { Alert.alert("Enter a subject", "Type the subject name, for example Maths."); return; }
    if (days.length === 0) { Alert.alert("Choose a day", "Select at least one day."); return; }
    if (!HHMM.test(start) || !HHMM.test(end)) { Alert.alert("Check the time", "Use 24-hour format, for example 16:30."); return; }
    if (start >= end) { Alert.alert("Check the time", "The end time must be after the start time."); return; }
    setBusy(true);
    let saved = 0;
    try {
      for (const d of days.slice().sort()) {
        const body = { day: d, start, end, subject: subject.trim(), class_id: classId, batch_id: batchId, room: room.trim(), note: note.trim() };
        if (editing) await api(`/teacher/timetable/${editing.id}`, { method: "PUT", body });
        else await api("/teacher/timetable", { method: "POST", body });
        saved += 1;
      }
      setShow(false);
    } catch (e: any) {
      Alert.alert(saved > 0 ? `Saved ${saved}, then stopped` : "Could not save", e?.message || "Please try again.");
    } finally {
      setBusy(false);
      await load();
    }
  };

  const remove = (e: any) => {
    Alert.alert("Delete this class?", `${e.subject} on ${FULL[e.day]}, ${fmt12(e.start)}. Students will be notified.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api(`/teacher/timetable/${e.id}`, { method: "DELETE" }); await load(); }
        catch (er: any) { Alert.alert("Error", er?.message || "Could not delete."); }
      } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Timetable</Text>
          <Text style={styles.sub}>{items.length} classes per week</Text>
        </View>
        <Pressable testID="add-class-btn" onPress={openNew} style={styles.addBtn}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addTxt}>Add</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayRow} style={{ flexGrow: 0 }}>
        {DAYS.map((d, i) => {
          const on = day === i;
          return (
            <Pressable key={d} onPress={() => setDay(i)} style={[styles.dayBtn, on && styles.dayOn]}>
              <Text style={[styles.dayTxt, on && { color: "#fff" }]}>{d}</Text>
              <Text style={[styles.dayCount, on && { color: "#fff" }]}>{counts[i] > 0 ? `${counts[i]}` : "-"}</Text>
              {i === todayIdx() ? <View style={styles.todayDot} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#35A7FF" /></View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={56} color="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTxt}>No classes on {FULL[day]}</Text>
          <Text style={{ color: DARK.sub, textAlign: "center" }}>Tap "Add" to schedule a class.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
          {list.map((e) => (
            <Pressable key={e.id} style={styles.card} onPress={() => openEdit(e)}>
              <View style={styles.timeBox}>
                <Text style={styles.timeTop}>{fmt12(e.start)}</Text>
                <Text style={styles.timeBottom}>{fmt12(e.end)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cTitle}>{e.subject}</Text>
                <Text style={styles.meta}>{nameOf(e)}{e.room ? ` • Room ${e.room}` : ""}</Text>
                {e.note ? <Text style={styles.note}>{e.note}</Text> : null}
              </View>
              <Pressable onPress={() => remove(e)} hitSlop={10} style={styles.delBtn}>
                <Ionicons name="trash" size={18} color="#F87171" />
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <InlineOverlay visible={show} onClose={() => setShow(false)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShow(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.lg }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{editing ? "Edit class" : "Add class"}</Text>

              <Text style={styles.label}>Subject</Text>
              <TextInput value={subject} onChangeText={setSubject} placeholder="e.g. Maths" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
              {subjects.length > 0 && (
                <View style={styles.wrap}>
                  {subjects.map((s: any) => (
                    <Pressable key={s.id} onPress={() => setSubject(s.name)} style={[styles.chip, subject === s.name && styles.chipOn]}>
                      <Text style={[styles.chipTxt, subject === s.name && { color: "#fff" }]}>{s.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              <Text style={styles.label}>{editing ? "Day" : "Days (you can pick several)"}</Text>
              <View style={styles.wrap}>
                {DAYS.map((d, i) => (
                  <Pressable key={d} onPress={() => toggleDay(i)} style={[styles.chip, days.includes(i) && styles.chipOn]}>
                    <Text style={[styles.chipTxt, days.includes(i) && { color: "#fff" }]}>{d}</Text>
                  </Pressable>
                ))}
              </View>

              <View style={{ flexDirection: "row", gap: SPACING.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Start (24h)</Text>
                  <TextInput value={start} onChangeText={setStart} placeholder="16:00" keyboardType="numbers-and-punctuation" maxLength={5} placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>End (24h)</Text>
                  <TextInput value={end} onChangeText={setEnd} placeholder="17:00" keyboardType="numbers-and-punctuation" maxLength={5} placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
                </View>
              </View>
              <View style={styles.wrap}>
                {[30, 45, 60, 90, 120].map((m) => (
                  <Pressable key={m} onPress={() => HHMM.test(start) && setEnd(addMinutes(start, m))} style={styles.chip}>
                    <Text style={styles.chipTxt}>{m >= 60 ? `${m / 60} hr` : `${m} min`}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.hint}>Type time like 16:30 for 4:30 PM. Tap a duration to fill the end time.</Text>

              {classes.length > 0 && (
                <>
                  <Text style={styles.label}>Class (optional)</Text>
                  <View style={styles.wrap}>
                    {classes.map((c) => (
                      <Pressable key={c.id} onPress={() => setClassId(classId === c.id ? undefined : c.id)} style={[styles.chip, classId === c.id && styles.chipOn]}>
                        <Text style={[styles.chipTxt, classId === c.id && { color: "#fff" }]}>{c.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
              {batches.length > 0 && (
                <>
                  <Text style={styles.label}>Batch (optional)</Text>
                  <View style={styles.wrap}>
                    {batches.map((b) => (
                      <Pressable key={b.id} onPress={() => setBatchId(batchId === b.id ? undefined : b.id)} style={[styles.chip, batchId === b.id && styles.chipOn]}>
                        <Text style={[styles.chipTxt, batchId === b.id && { color: "#fff" }]}>{b.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
              <Text style={styles.hint}>Leave class and batch empty if the class is for all your students.</Text>

              <View style={{ flexDirection: "row", gap: SPACING.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Room (optional)</Text>
                  <TextInput value={room} onChangeText={setRoom} placeholder="e.g. 2" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
                </View>
                <View style={{ flex: 2 }}>
                  <Text style={styles.label}>Note (optional)</Text>
                  <TextInput value={note} onChangeText={setNote} placeholder="e.g. Bring notebook" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
                </View>
              </View>

              <Pressable testID="save-class" onPress={save} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>{editing ? "Save changes" : days.length > 1 ? `Add to ${days.length} days` : "Add class"}</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </InlineOverlay>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  sub: { color: DARK.sub, fontSize: 12, marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: "#1F6BFF" },
  addTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  dayRow: { gap: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  dayBtn: { width: 54, height: 62, borderRadius: 14, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center", gap: 2 },
  dayOn: { backgroundColor: "#1F6BFF", borderColor: "#1F6BFF" },
  dayTxt: { color: DARK.sub, fontWeight: "800", fontSize: 13 },
  dayCount: { color: DARK.sub, fontSize: 12, fontWeight: "700" },
  todayDot: { position: "absolute", top: 5, right: 6, width: 7, height: 7, borderRadius: 4, backgroundColor: "#F59E0B" },
  emptyTxt: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: SPACING.md },
  card: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, backgroundColor: DARK.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: DARK.border },
  timeBox: { alignItems: "center", paddingRight: SPACING.md, borderRightWidth: 1, borderRightColor: DARK.border, minWidth: 74 },
  timeTop: { color: "#fff", fontWeight: "800", fontSize: 13 },
  timeBottom: { color: DARK.sub, fontSize: 11, marginTop: 4 },
  cTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  meta: { color: DARK.sub, fontSize: 12, marginTop: 3 },
  note: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 4 },
  delBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(248,113,113,0.12)", alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, maxHeight: "92%" },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  label: { color: DARK.sub, fontSize: 12, fontWeight: "700", marginTop: SPACING.md, marginBottom: 6, textTransform: "uppercase" },
  input: { minHeight: 46, borderRadius: RADIUS.md, backgroundColor: DARK.input, color: "#fff", paddingHorizontal: SPACING.md, fontSize: 15, borderWidth: 1, borderColor: DARK.border },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: SPACING.sm },
  chip: { paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#1F6BFF", borderColor: "#1F6BFF" },
  chipTxt: { color: DARK.sub, fontSize: 13, fontWeight: "600" },
  hint: { color: DARK.sub, fontSize: 11, marginTop: 8, lineHeight: 16 },
  saveBtn: { height: 50, borderRadius: RADIUS.md, backgroundColor: "#1F6BFF", alignItems: "center", justifyContent: "center", marginTop: SPACING.xl },
  saveTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
