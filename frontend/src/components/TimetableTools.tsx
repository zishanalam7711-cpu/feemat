import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { addDaysYmd, dayLabel, localToday } from "@/src/lib/hwFiles";

const FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const REASONS = ["Teacher unwell", "Holiday", "Exam / event", "Bad weather"];
const weekday = (ymd: string) => (new Date(ymd + "T00:00:00Z").getUTCDay() + 6) % 7;

// The next 5 dates on which this class happens (today included if it is today's weekday)
function nextDates(day: number): string[] {
  const t = localToday();
  const out: string[] = [];
  for (let i = 0; i < 40 && out.length < 5; i++) { const d = addDaysYmd(t, i); if (weekday(d) === day) out.push(d); }
  return out;
}

// Teacher: cancel ONE class on ONE date (students are notified), or bring it back.
export function CancelClassSheet({ visible, onClose, entry, cancelled, bottomInset, onChanged }: {
  visible: boolean; onClose: () => void; entry: any; cancelled: any[]; bottomInset: number; onChanged: () => void;
}) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const dates = entry ? nextDates(entry.day) : [];
  const mine = (cancelled || []).filter((c) => c.entry_id === entry?.id);
  useEffect(() => { if (visible) { setDate(dates.find((d) => !mine.some((c) => c.date === d)) || ""); setReason(""); } }, [visible, entry?.id]); // eslint-disable-line

  const cancel = async () => {
    if (!date || busy) return;
    setBusy(true);
    try { await api(`/teacher/timetable/${entry.id}/cancel`, { method: "POST", body: { date, reason: reason.trim() } }); onChanged(); onClose(); Alert.alert("Class cancelled", "Students have been notified."); }
    catch (e: any) { Alert.alert("Could not cancel", e?.message || "Please try again."); }
    setBusy(false);
  };
  const restore = async (d: string) => {
    try { await api(`/teacher/timetable/${entry.id}/cancel/${d}`, { method: "DELETE" }); onChanged(); } catch (e: any) { Alert.alert("Could not restore", e?.message || ""); }
  };

  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}><View style={{ flex: 1 }}><Text style={s.title}>Cancel a class</Text><Text style={s.sub}>{entry?.subject}  •  every {FULL[entry?.day ?? 0]}  {entry?.start}-{entry?.end}</Text></View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable></View>
          <Text style={s.lbl}>Which day?</Text>
          <View style={s.wrap}>{dates.map((d) => {
            const done = mine.some((c) => c.date === d);
            return <Pressable key={d} disabled={done} onPress={() => setDate(d)} style={[s.chip, date === d && s.chipOn, done && { opacity: 0.4 }]}>
              <Text style={[s.chipTxt, date === d && { color: "#fff" }]}>{dayLabel(d, localToday())} {d.slice(8)}/{d.slice(5, 7)}{done ? " ✓" : ""}</Text></Pressable>;
          })}</View>
          <Text style={s.lbl}>Reason (students will see it)</Text>
          <View style={s.wrap}>{REASONS.map((r) => <Pressable key={r} onPress={() => setReason(r)} style={[s.chip, reason === r && s.chipOn]}><Text style={[s.chipTxt, reason === r && { color: "#fff" }]}>{r}</Text></Pressable>)}</View>
          <TextInput value={reason} onChangeText={setReason} placeholder="Or write your own reason" placeholderTextColor="#94A3B8" style={s.input} maxLength={120} />
          <Pressable onPress={cancel} disabled={!date || busy} style={[s.go, (!date || busy) && { opacity: 0.5 }]} testID="cancel-class-go">
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="close-circle" size={18} color="#fff" /><Text style={s.goTxt}>Cancel this class and notify students</Text></>}
          </Pressable>
          {mine.length ? (
            <View style={{ marginTop: 14 }}>
              <Text style={s.lbl}>Already cancelled</Text>
              {mine.map((c) => (
                <View key={c.date} style={s.row}>
                  <Text style={s.rowTxt}>{dayLabel(c.date, localToday())}  {c.date}{c.reason ? `  •  ${c.reason}` : ""}</Text>
                  <Pressable onPress={() => restore(c.date)} hitSlop={8}><Text style={s.restore}>Bring back</Text></Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </InlineOverlay>
  );
}

// Teacher: copy all classes of one day to other days (clashing slots are skipped).
export function CopyDaySheet({ visible, onClose, fromDay, bottomInset, onDone }: { visible: boolean; onClose: () => void; fromDay: number; bottomInset: number; onDone: () => void }) {
  const [to, setTo] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (visible) setTo([]); }, [visible]);
  const run = async () => {
    if (!to.length || busy) return;
    setBusy(true);
    try {
      const r: any = await api("/teacher/timetable/copy-day", { method: "POST", body: { from_day: fromDay, to_days: to } });
      onDone(); onClose();
      Alert.alert("Copied", `${r.added} class slot${r.added === 1 ? "" : "s"} added.` + (r.skipped?.length ? `\n${r.skipped.length} skipped because of a clash (${r.skipped.slice(0, 3).map((x: any) => `${x.day} ${x.subject}`).join(", ")}).` : ""));
    } catch (e: any) { Alert.alert("Could not copy", e?.message || ""); }
    setBusy(false);
  };
  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}><View style={{ flex: 1 }}><Text style={s.title}>Copy {FULL[fromDay]}</Text><Text style={s.sub}>All classes of {FULL[fromDay]} will be added to the days you choose</Text></View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable></View>
          <Text style={s.lbl}>Copy to</Text>
          <View style={s.wrap}>{SHORT.map((d, i) => i === fromDay ? null : (
            <Pressable key={d} onPress={() => setTo((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))} style={[s.chip, to.includes(i) && s.chipOn]}>
              <Text style={[s.chipTxt, to.includes(i) && { color: "#fff" }]}>{d}</Text></Pressable>))}</View>
          <Pressable onPress={run} disabled={!to.length || busy} style={[s.go, { backgroundColor: "#1F6BFF" }, (!to.length || busy) && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="copy" size={17} color="#fff" /><Text style={s.goTxt}>Copy to {to.length || "…"} day{to.length === 1 ? "" : "s"}</Text></>}
          </Pressable>
        </View>
      </View>
    </InlineOverlay>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  lbl: { color: "#1F6BFF", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 13, height: 36, borderRadius: 999, backgroundColor: "#EEF4FF", alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#1F6BFF" },
  chipTxt: { color: "#1F6BFF", fontWeight: "700", fontSize: 13 },
  input: { backgroundColor: "#F4F8FF", borderRadius: 12, paddingHorizontal: 12, height: 46, fontSize: 14, color: "#0F172A", marginTop: 10 },
  go: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, backgroundColor: "#DC2626", marginTop: 14 },
  goTxt: { color: "#fff", fontWeight: "800", fontSize: 14.5 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#EEF2F7", gap: 8 },
  rowTxt: { flex: 1, color: "#334155", fontSize: 13 },
  restore: { color: "#16A34A", fontWeight: "800", fontSize: 13 },
});
