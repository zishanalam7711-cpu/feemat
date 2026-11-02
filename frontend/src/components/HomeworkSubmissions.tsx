import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { HomeworkPhotoViewer } from "@/src/components/HomeworkPhotoViewer";
import { dataUri, fmtWhen } from "@/src/lib/hwFiles";

type Tab = "received" | "pending";

const PILL: Record<string, { c: string; bg: string; t: string }> = {
  submitted: { c: "#1F6BFF", bg: "#E0ECFF", t: "New" },
  reviewed: { c: "#16A34A", bg: "#DCFCE7", t: "Checked" },
  redo: { c: "#B45309", bg: "#FEF3C7", t: "Redo asked" },
};

// Teacher: see who sent the homework, open the photos, write a remark / marks, or send it back for correction.
export function HomeworkSubmissions({ visible, onClose, homework, bottomInset, onChanged }: { visible: boolean; onClose: () => void; homework: any; bottomInset: number; onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("received");
  const [sel, setSel] = useState<any>(null);       // opened submission (detail)
  const [remark, setRemark] = useState("");
  const [marks, setMarks] = useState("");
  const [outOf, setOutOf] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [view, setView] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!homework) return;
    setLoading(true); setErr("");
    try { setData(await api(`/teacher/homework/${homework.id}/submissions`)); }
    catch (e: any) { setErr(e?.message || "Could not load."); }
    finally { setLoading(false); }
  }, [homework?.id]);

  useEffect(() => { if (visible) { setTab("received"); setSel(null); load(); } }, [visible, load]);

  const open = async (row: any) => {
    setErr("");
    try {
      const d: any = await api(`/teacher/homework/submissions/${row.id}`);
      setSel(d); setRemark(d.remark || ""); setMarks(d.marks != null ? String(d.marks) : ""); setOutOf(d.out_of != null ? String(d.out_of) : "");
    } catch (e: any) { Alert.alert("Could not open", e?.message || "Please try again."); }
  };

  const review = async (status: "reviewed" | "redo") => {
    if (!sel || busy) return;
    setErr("");
    const m = marks.trim() === "" ? null : parseFloat(marks);
    const o = outOf.trim() === "" ? null : parseFloat(outOf);
    if (m !== null && (!isFinite(m) || m < 0)) return setErr("Marks must be a number");
    if (m !== null && o !== null && m > o) return setErr("Marks cannot be more than the total");
    if (status === "redo" && !remark.trim()) return setErr("Write what the student should correct");
    setBusy(true);
    try {
      await api(`/teacher/homework/submissions/${sel.id}/review`, { method: "POST", body: { status, remark: remark.trim(), marks: m, out_of: m !== null ? o : null } });
      setSel(null); onChanged(); await load();
    } catch (e: any) { setErr(e?.message || "Could not save."); }
    finally { setBusy(false); }
  };

  const received = data?.submitted || [];
  const pending = data?.pending || [];

  return (
    <InlineOverlay visible={visible} onClose={sel ? () => setSel(null) : onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}>
            {sel ? <Pressable onPress={() => setSel(null)} hitSlop={10}><Ionicons name="chevron-back" size={24} color="#1F6BFF" /></Pressable> : null}
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={2}>{sel ? sel.name : homework?.title}</Text>
              <Text style={s.sub}>{sel ? homework?.title : `${received.length} of ${data?.total ?? "-"} students sent it`}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable>
          </View>

          {loading && !data ? <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} /> : sel ? (
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 580 }}>
              <View style={s.rowTop}>
                <View style={[s.pill, { backgroundColor: PILL[sel.status]?.bg }]}><Text style={[s.pillTxt, { color: PILL[sel.status]?.c }]}>{PILL[sel.status]?.t}</Text></View>
                {sel.late ? <View style={[s.pill, { backgroundColor: "#FEE2E2" }]}><Text style={[s.pillTxt, { color: "#B91C1C" }]}>Late</Text></View> : null}
                <Text style={s.when}>{fmtWhen(sel.updated_at || sel.submitted_at)}{sel.resubmits ? `  ·  sent ${sel.resubmits + 1} times` : ""}</Text>
              </View>
              {sel.note ? <Text style={s.note}>"{sel.note}"</Text> : null}
              <Text style={s.lbl}>Photos (tap to open)</Text>
              <View style={s.grid}>
                {(sel.files || []).map((f: any) => (
                  <Pressable key={f.id} onPress={() => setView(f.id)} testID="hw-open-photo"><Image source={{ uri: dataUri(f.mime, f.thumb) }} style={s.gridImg} /></Pressable>
                ))}
              </View>

              <Text style={s.lbl}>Your remark</Text>
              <TextInput value={remark} onChangeText={setRemark} placeholder="Good work / correct Q3 ..." placeholderTextColor="#94A3B8" multiline style={s.input} maxLength={500} />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={marks} onChangeText={setMarks} placeholder="Marks (optional)" placeholderTextColor="#94A3B8" keyboardType="numeric" style={[s.input, { flex: 1 }]} />
                <TextInput value={outOf} onChangeText={setOutOf} placeholder="Out of" placeholderTextColor="#94A3B8" keyboardType="numeric" style={[s.input, { flex: 1 }]} />
              </View>
              {err ? <Text style={s.err}>{err}</Text> : null}
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <Pressable onPress={() => review("reviewed")} disabled={busy} style={[s.ok, busy && { opacity: 0.5 }]} testID="hw-mark-checked">
                  {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark-circle" size={18} color="#fff" /><Text style={s.okTxt}>Mark checked</Text></>}
                </Pressable>
                <Pressable onPress={() => review("redo")} disabled={busy} style={[s.redo, busy && { opacity: 0.5 }]} testID="hw-ask-redo"><Text style={s.redoTxt}>Ask to redo</Text></Pressable>
              </View>
              <Text style={s.hint}>The student gets a notification with your remark.</Text>
            </ScrollView>
          ) : (
            <>
              <View style={s.seg}>
                {([["received", `Received (${received.length})`], ["pending", `Not sent (${pending.length})`]] as [Tab, string][]).map(([k, l]) => (
                  <Pressable key={k} onPress={() => setTab(k)} style={[s.segBtn, tab === k && s.segOn]}><Text style={[s.segTxt, tab === k && { color: "#fff" }]}>{l}</Text></Pressable>
                ))}
              </View>
              {err ? <Text style={s.err}>{err}</Text> : null}
              <ScrollView style={{ maxHeight: 520 }}>
                {tab === "received" ? (received.length === 0 ? <Text style={s.empty}>No one has sent this homework yet.</Text> : received.map((r: any) => (
                  <Pressable key={r.id} onPress={() => open(r)} style={s.row} testID="hw-submission-row">
                    {r.files?.[0]?.thumb ? <Image source={{ uri: dataUri(r.files[0].mime, r.files[0].thumb) }} style={s.rowImg} /> : <View style={[s.rowImg, { backgroundColor: "#E2E8F0" }]} />}
                    <View style={{ flex: 1 }}>
                      <Text style={s.rowName}>{r.name}</Text>
                      <Text style={s.when}>{fmtWhen(r.updated_at || r.submitted_at)}  ·  {r.file_count} photo{r.file_count === 1 ? "" : "s"}{r.late ? "  ·  late" : ""}</Text>
                    </View>
                    <View style={[s.pill, { backgroundColor: PILL[r.status]?.bg }]}><Text style={[s.pillTxt, { color: PILL[r.status]?.c }]}>{PILL[r.status]?.t}</Text></View>
                  </Pressable>
                ))) : (pending.length === 0 ? <Text style={s.empty}>Everyone has sent it.</Text> : pending.map((p: any) => (
                  <View key={p.student_user_id} style={s.row}><Ionicons name="person-circle-outline" size={34} color="#94A3B8" /><Text style={[s.rowName, { flex: 1 }]}>{p.name}</Text></View>
                )))}
              </ScrollView>
            </>
          )}
        </View>
      </View>
      <HomeworkPhotoViewer fileId={view} role="teacher" onClose={() => setView(null)} />
    </InlineOverlay>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  seg: { flexDirection: "row", backgroundColor: "#EEF4FF", borderRadius: 14, padding: 3, marginBottom: 8 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 11 },
  segOn: { backgroundColor: "#1F6BFF" },
  segTxt: { fontWeight: "800", color: "#1F6BFF", fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#EEF2F7" },
  rowImg: { width: 52, height: 52, borderRadius: 10 },
  rowName: { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  when: { fontSize: 11.5, color: "#64748B", marginTop: 2 },
  pill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999 },
  pillTxt: { fontSize: 11, fontWeight: "800" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  note: { color: "#334155", fontSize: 14, fontStyle: "italic", marginTop: 10 },
  lbl: { color: "#1F6BFF", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  gridImg: { width: 96, height: 96, borderRadius: 12, backgroundColor: "#E2E8F0" },
  input: { backgroundColor: "#F4F8FF", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#0F172A", marginTop: 8 },
  err: { color: "#B91C1C", fontSize: 13, marginTop: 8 },
  ok: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: 14, backgroundColor: "#16A34A" },
  okTxt: { color: "#fff", fontWeight: "800", fontSize: 14 },
  redo: { flex: 1, alignItems: "center", justifyContent: "center", height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: "#F59E0B", backgroundColor: "#FFFBEB" },
  redoTxt: { color: "#B45309", fontWeight: "800", fontSize: 14 },
  hint: { color: "#64748B", fontSize: 11.5, marginTop: 8 },
  empty: { color: "#64748B", textAlign: "center", padding: 28 },
});
