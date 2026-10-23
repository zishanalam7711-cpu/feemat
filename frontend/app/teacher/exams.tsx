import React, { useCallback, useMemo, useState } from "react";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, KeyboardAvoidingView, Platform,
  TextInput, Alert, Share,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";
import { ProUpgradeModal } from "@/src/components/ProUpgradeModal";

const DARK = {
  bg: "#071B45",
  card: "#0E2A63",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  input: "rgba(255,255,255,0.07)",
};

function gradeOf(pct: number) {
  if (pct >= 90) return "A+";
  if (pct >= 80) return "A";
  if (pct >= 70) return "B+";
  if (pct >= 60) return "B";
  if (pct >= 50) return "C";
  if (pct >= 40) return "D";
  return "F";
}
function gradeColor(g: string) {
  if (g === "A+" || g === "A") return "#10B981";
  if (g === "B+" || g === "B") return "#3B82F6";
  if (g === "C" || g === "D") return "#F59E0B";
  return "#EF4444";
}
const todayStr = () => new Date().toISOString().slice(0, 10);
function addDays(d: string, n: number) {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const r1 = (n: number) => Math.round(n * 10) / 10;

export default function Exams() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [exams, setExams] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [marksBy, setMarksBy] = useState<Record<string, any[]>>({});
  const [teacherName, setTeacherName] = useState("");
  const [loading, setLoading] = useState(true);
  const [pro, setPro] = useState(false);
  const [busy, setBusy] = useState(false);

  const [selected, setSelected] = useState<any>(null);   // exam detail
  const [showNew, setShowNew] = useState(false);
  const [entry, setEntry] = useState<any>(null);          // exam for marks entry
  const [marksMap, setMarksMap] = useState<Record<string, string>>({});

  // create form
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [total, setTotal] = useState("100");
  const [pass, setPass] = useState("35");
  const [date, setDate] = useState(todayStr());

  const load = useCallback(async () => {
    try {
      const [e, s, sub, prof]: any = await Promise.all([
        api("/teacher/exams"),
        api("/teacher/students?filter=all&limit=200"),
        api("/teacher/subjects").catch(() => []),
        api("/teacher/profile").catch(() => ({})),
      ]);
      setExams(e || []);
      setStudents(s.items || []);
      setSubjects(sub || []);
      setTeacherName(prof?.coaching_name || prof?.name || "");
      const entries = await Promise.all((e || []).map((x: any) => api(`/teacher/exams/${x.id}/marks`).catch(() => [])));
      const map: Record<string, any[]> = {};
      (e || []).forEach((x: any, i: number) => { map[x.id] = entries[i] as any[]; });
      setMarksBy(map);
      // keep open detail fresh
      setSelected((cur: any) => (cur ? (e || []).find((x: any) => x.id === cur.id) || null : null));
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const nameOf = useMemo(() => {
    const m: Record<string, any> = {};
    students.forEach((c) => { m[c.student_user_id] = c; });
    return m;
  }, [students]);

  const statsOf = (ex: any) => {
    const list = marksBy[ex.id] || [];
    const n = list.length;
    if (!n) return { n: 0, avg: 0, passPct: 0, high: 0, low: 0, top: null as any };
    const avg = list.reduce((a, x) => a + (x.percentage || 0), 0) / n;
    const passN = list.filter((x) => x.result === "pass").length;
    const sorted = [...list].sort((a, b) => b.marks - a.marks);
    return { n, avg: r1(avg), passPct: Math.round((passN / n) * 100), high: sorted[0].marks, low: sorted[n - 1].marks, top: sorted[0] };
  };

  const ranked = (ex: any) => {
    const list = [...(marksBy[ex.id] || [])].sort((a, b) => b.marks - a.marks);
    let rank = 0; let prev: number | null = null;
    return list.map((m, i) => {
      if (prev === null || m.marks !== prev) rank = i + 1;
      prev = m.marks;
      return { ...m, rank };
    });
  };

  // ---------- create exam
  const create = async () => {
    if (!title.trim()) { Alert.alert("Enter a title", "Enter the exam name."); return; }
    const t = parseFloat(total), p = parseFloat(pass);
    if (!(t > 0) || isNaN(p) || p > t) { Alert.alert("Check the marks", "Total marks must be above 0 and passing marks must not exceed total marks."); return; }
    setBusy(true);
    try {
      await api("/teacher/exams", { method: "POST", body: { title: title.trim(), subject, total_marks: t, passing_marks: p, exam_date: date } });
      setShowNew(false); setTitle(""); setSubject(""); setTotal("100"); setPass("35");
      await load();
    } catch (e: any) {
      if (String(e?.message || "").includes("Upgrade to Pro")) { setShowNew(false); setPro(true); }
      else Alert.alert("Error", e?.message || "Could not create the exam.");
    } finally { setBusy(false); }
  };

  // ---------- marks entry
  const openEntry = (ex: any) => {
    const m: Record<string, string> = {};
    (marksBy[ex.id] || []).forEach((x) => { m[x.student_user_id] = String(x.marks); });
    setMarksMap(m);
    setEntry(ex);
  };
  const saveMarks = async () => {
    const totalM = parseFloat(entry.total_marks);
    const list: { student_user_id: string; marks: number }[] = [];
    for (const [uid, v] of Object.entries(marksMap)) {
      if (v === "" || isNaN(parseFloat(v))) continue;
      const num = parseFloat(v);
      if (num < 0 || num > totalM) {
        Alert.alert("Invalid marks", `Marks for ${nameOf[uid]?.student?.name || "Student"} must be between 0 and ${totalM}.`);
        return;
      }
      list.push({ student_user_id: uid, marks: num });
    }
    if (!list.length) { Alert.alert("Nothing entered", "Enter marks for at least one student."); return; }
    setBusy(true);
    try {
      await api(`/teacher/exams/${entry.id}/marks`, { method: "POST", body: { entries: list } });
      setEntry(null);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save the marks.");
    } finally { setBusy(false); }
  };

  // ---------- share
  const shareResults = async (ex: any) => {
    const rows = ranked(ex);
    if (!rows.length) { Alert.alert("No results", "Enter marks first."); return; }
    const medal = (r: number) => (r === 1 ? "🥇" : r === 2 ? "🥈" : r === 3 ? "🥉" : `${r}.`);
    const lines = rows.map((m) => `${medal(m.rank)} ${nameOf[m.student_user_id]?.student?.name || "Student"} — ${m.marks}/${ex.total_marks} (${m.grade})`);
    await Share.share({ message: `📝 ${ex.title}${ex.subject ? " — " + ex.subject : ""}\n${ex.exam_date}\n\n${lines.join("\n")}` });
  };

  // ---------- marksheet PDF
  const marksheet = async (uid: string) => {
    const c = nameOf[uid];
    const rows = exams
      .map((ex) => {
        const m = (marksBy[ex.id] || []).find((x) => x.student_user_id === uid);
        return m ? { ex, m } : null;
      })
      .filter(Boolean) as { ex: any; m: any }[];
    if (!rows.length) { Alert.alert("No marks", "No marks have been entered for this student yet."); return; }
    const sumMarks = rows.reduce((a, r) => a + r.m.marks, 0);
    const sumTotal = rows.reduce((a, r) => a + Number(r.ex.total_marks), 0);
    const pct = sumTotal ? (sumMarks / sumTotal) * 100 : 0;
    const overall = gradeOf(pct);
    const tr = rows
      .map((r) => `<tr><td>${esc(r.ex.title)}</td><td>${esc(r.ex.subject || "-")}</td><td>${esc(r.ex.exam_date)}</td><td>${r.m.marks}/${r.ex.total_marks}</td><td>${r.m.percentage}%</td><td>${esc(r.m.grade)}</td><td style="color:${r.m.result === "pass" ? "#059669" : "#DC2626"}">${r.m.result === "pass" ? "Pass" : "Fail"}</td></tr>`)
      .join("");
    const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>
      body{font-family:Arial,sans-serif;padding:24px;color:#111}
      h1{margin:0;color:#5B21B6} .sub{color:#555;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:18px;font-size:13px}
      th{background:#5B21B6;color:#fff;text-align:left;padding:8px} td{padding:8px;border-bottom:1px solid #ddd}
      .box{margin-top:18px;padding:14px;border:2px solid #5B21B6;border-radius:10px;font-size:15px}
    </style></head><body>
      <h1>${esc(teacherName || "FeeMat")}</h1>
      <div class="sub">Report Card</div>
      <p><b>Name:</b> ${esc(c?.student?.name || "")}<br/><b>Admission No:</b> ${esc(c?.admission_number || "")}</p>
      <table><tr><th>Exam</th><th>Subject</th><th>Date</th><th>Marks</th><th>%</th><th>Grade</th><th>Result</th></tr>${tr}</table>
      <div class="box"><b>Total:</b> ${sumMarks}/${sumTotal} &nbsp; <b>Percentage:</b> ${r1(pct)}% &nbsp; <b>Grade:</b> ${overall}</div>
    </body></html>`;
    try {
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Report Card" });
      else Alert.alert("PDF created", uri);
    } catch {
      Alert.alert("Error", "Could not create the PDF.");
    }
  };

  const det = selected ? statsOf(selected) : null;
  const detRows = selected ? ranked(selected) : [];

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={styles.title}>Exams & Results</Text>
        <Pressable testID="new-exam-btn" onPress={() => setShowNew(true)} style={styles.addBtn}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addTxt}>New</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#35A7FF" /></View>
      ) : exams.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="document-text-outline" size={56} color="rgba(255,255,255,0.25)" />
          <Text style={styles.emptyTxt}>No exams yet</Text>
          <Text style={{ color: DARK.sub }}>Tap "New" above to create your first test.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
          {exams.map((e) => {
            const st = statsOf(e);
            const topName = st.top ? nameOf[st.top.student_user_id]?.student?.name : "";
            const entered = `${st.n}/${students.length}`;
            return (
              <Pressable key={e.id} style={styles.card} onPress={() => setSelected(e)} testID={`exam-${e.id}`}>
                <View style={styles.rowTop}>
                  <View style={styles.icnWrap}><Ionicons name="document-text" size={20} color="#10B981" /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cTitle}>{e.title}</Text>
                    <Text style={styles.meta}>{e.subject || "General"} • {e.exam_date} • Total {e.total_marks}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={DARK.sub} />
                </View>
                {st.n > 0 ? (
                  <View style={styles.statRow}>
                    <Mini label="Average" value={`${st.avg}%`} color="#35A7FF" />
                    <Mini label="Pass" value={`${st.passPct}%`} color="#10B981" />
                    <Mini label="Highest" value={String(st.high)} color="#F59E0B" />
                    <Mini label="Marks" value={entered} color="#3B82F6" />
                  </View>
                ) : (
                  <Text style={[styles.meta, { marginTop: 8 }]}>Marks have not been entered yet.</Text>
                )}
                {topName ? <Text style={styles.topper}>🏆 Topper: {topName} ({st.top.percentage}%)</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* ---------- exam detail ---------- */}
      <InlineOverlay visible={!!selected} onClose={() => setSelected(null)}>
        <View style={{ flex: 1, backgroundColor: DARK.bg }}>
          <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
            <Pressable onPress={() => setSelected(null)} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>{selected?.title}</Text>
              <Text style={styles.meta}>{selected?.subject || "General"} • {selected?.exam_date} • Total {selected?.total_marks} • Pass {selected?.passing_marks}</Text>
            </View>
          </View>

          <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xxl }}>
            {det && det.n > 0 && (
              <View style={styles.statRow}>
                <Mini label="Average" value={`${det.avg}%`} color="#35A7FF" />
                <Mini label="Pass" value={`${det.passPct}%`} color="#10B981" />
                <Mini label="Highest" value={String(det.high)} color="#F59E0B" />
                <Mini label="Lowest" value={String(det.low)} color="#EF4444" />
              </View>
            )}

            <View style={{ flexDirection: "row", gap: SPACING.sm }}>
              <Pressable onPress={() => selected && openEntry(selected)} style={[styles.action, { backgroundColor: "#1F6BFF" }]}>
                <Ionicons name="create" size={16} color="#fff" />
                <Text style={styles.actionTxt}>Enter / Edit Marks</Text>
              </Pressable>
              <Pressable onPress={() => selected && shareResults(selected)} style={[styles.action, { backgroundColor: "rgba(53,167,255,0.18)" }]}>
                <Ionicons name="share-social" size={16} color="#35A7FF" />
                <Text style={[styles.actionTxt, { color: "#35A7FF" }]}>Share</Text>
              </Pressable>
            </View>

            {detRows.length === 0 ? (
              <View style={[styles.center, { paddingVertical: 40 }]}>
                <Ionicons name="trophy-outline" size={48} color="rgba(255,255,255,0.25)" />
                <Text style={{ color: DARK.sub, marginTop: 8 }}>Rankings will appear here once marks are entered.</Text>
              </View>
            ) : (
              detRows.map((m) => {
                const c = nameOf[m.student_user_id];
                const medal = m.rank === 1 ? "🥇" : m.rank === 2 ? "🥈" : m.rank === 3 ? "🥉" : `#${m.rank}`;
                return (
                  <View key={m.id} style={[styles.rankRow, m.rank === 1 && { borderColor: "#F59E0B" }]}>
                    <Text style={styles.medal}>{medal}</Text>
                    <Avatar name={c?.student?.name} uri={c?.student?.photo_url} size={36} bg="rgba(53,167,255,0.2)" fg="#9CC3FF" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{c?.student?.name || "Student"}</Text>
                      <Text style={styles.meta}>{m.marks}/{selected?.total_marks} • {m.percentage}% • {m.result === "pass" ? "Pass" : "Fail"}</Text>
                    </View>
                    <View style={[styles.gradePill, { backgroundColor: gradeColor(m.grade) + "26" }]}>
                      <Text style={[styles.gradeTxt, { color: gradeColor(m.grade) }]}>{m.grade}</Text>
                    </View>
                    <Pressable onPress={() => marksheet(m.student_user_id)} hitSlop={8} style={styles.pdfBtn}>
                      <Ionicons name="document-attach" size={18} color="#35A7FF" />
                    </Pressable>
                  </View>
                );
              })
            )}
            <Text style={[styles.meta, { textAlign: "center", marginTop: 8 }]}>PDF icon = that student's full report card (all exams)</Text>
          </ScrollView>
        </View>
      </InlineOverlay>

      {/* ---------- new exam ---------- */}
      <InlineOverlay visible={showNew} onClose={() => setShowNew(false)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowNew(false)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.lg }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>New Exam</Text>
              <Text style={styles.label}>Title</Text>
              <TextInput testID="e-title" value={title} onChangeText={setTitle} placeholder="Mid-term Math" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
              <Text style={styles.label}>Subject</Text>
              <TextInput testID="e-subject" value={subject} onChangeText={setSubject} placeholder="Maths" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
              {subjects.length > 0 && (
                <View style={styles.wrap}>
                  {subjects.map((s: any) => (
                    <Pressable key={s.id} onPress={() => setSubject(s.name)} style={[styles.chip, subject === s.name && styles.chipOn]}>
                      <Text style={[styles.chipTxt, subject === s.name && { color: "#fff" }]}>{s.name}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <View style={{ flexDirection: "row", gap: SPACING.md }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Total marks</Text>
                  <TextInput value={total} onChangeText={setTotal} keyboardType="decimal-pad" style={styles.input} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Passing marks</Text>
                  <TextInput value={pass} onChangeText={setPass} keyboardType="decimal-pad" style={styles.input} />
                </View>
              </View>
              <Text style={styles.label}>Date (YYYY-MM-DD)</Text>
              <TextInput testID="e-date" value={date} onChangeText={setDate} style={styles.input} />
              <View style={styles.wrap}>
                {[["Today", 0], ["Tomorrow", 1], ["Next week", 7]].map(([l, n]) => (
                  <Pressable key={String(l)} onPress={() => setDate(addDays(todayStr(), Number(n)))} style={styles.chip}>
                    <Text style={styles.chipTxt}>{l}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable testID="e-save" onPress={create} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Create Exam</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </InlineOverlay>

      {/* ---------- marks entry ---------- */}
      <InlineOverlay visible={!!entry} onClose={() => setEntry(null)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setEntry(null)} />
          <View style={[styles.sheet, { maxHeight: "88%", paddingBottom: insets.bottom + SPACING.lg }]}>
            <Text style={styles.sheetTitle}>Marks — {entry?.title}</Text>
            <Text style={styles.meta}>Total {entry?.total_marks} • Passing {entry?.passing_marks}</Text>
            <ScrollView style={{ marginTop: SPACING.md }} contentContainerStyle={{ gap: SPACING.sm }} keyboardShouldPersistTaps="handled">
              {students.map((c: any) => {
                const v = marksMap[c.student_user_id] || "";
                const num = parseFloat(v);
                const ok = v !== "" && !isNaN(num);
                const pct = ok && entry ? (num / Number(entry.total_marks)) * 100 : 0;
                const g = gradeOf(pct);
                const failed = ok && entry ? num < Number(entry.passing_marks) : false;
                const over = ok && entry ? num > Number(entry.total_marks) : false;
                return (
                  <View key={c.id} style={styles.markRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{c.student?.name}</Text>
                      <Text style={styles.meta}>{c.admission_number}</Text>
                    </View>
                    {ok && !over ? (
                      <View style={[styles.gradePill, { backgroundColor: (failed ? "#EF4444" : gradeColor(g)) + "26" }]}>
                        <Text style={[styles.gradeTxt, { color: failed ? "#EF4444" : gradeColor(g) }]}>{failed ? "Fail" : g}</Text>
                      </View>
                    ) : over ? <Text style={{ color: "#EF4444", fontSize: 11 }}>Too high</Text> : null}
                    <TextInput
                      testID={`marks-${c.student_user_id}`}
                      value={v}
                      onChangeText={(t) => setMarksMap((p) => ({ ...p, [c.student_user_id]: t }))}
                      keyboardType="decimal-pad"
                      placeholder="—"
                      placeholderTextColor="rgba(255,255,255,0.35)"
                      style={styles.markInput}
                    />
                  </View>
                );
              })}
            </ScrollView>
            <Pressable testID="save-marks" onPress={saveMarks} disabled={busy} style={[styles.saveBtn, busy && { opacity: 0.6 }]}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Save & Notify Students</Text>}
            </Pressable>
          </View>
        </View>
      </InlineOverlay>

      <ProUpgradeModal visible={pro} onClose={() => setPro(false)} feature="Exams & Results" />
    </View>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.mini}>
      <Text style={[styles.miniV, { color }]}>{value}</Text>
      <Text style={styles.miniL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  title: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "800" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: "#1F6BFF" },
  addTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  emptyTxt: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: SPACING.md },
  card: { padding: SPACING.md, backgroundColor: DARK.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: DARK.border },
  rowTop: { flexDirection: "row", alignItems: "center", gap: SPACING.md },
  icnWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(16,185,129,0.15)" },
  cTitle: { color: "#fff", fontSize: 15, fontWeight: "800" },
  meta: { color: DARK.sub, fontSize: 12, marginTop: 2 },
  statRow: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.sm },
  mini: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.05)" },
  miniV: { fontSize: 15, fontWeight: "800" },
  miniL: { color: DARK.sub, fontSize: 10, marginTop: 2 },
  topper: { color: "#FBBF24", fontSize: 12, fontWeight: "700", marginTop: 8 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12 },
  actionTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  rankRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border },
  medal: { width: 32, textAlign: "center", color: "#fff", fontSize: 16, fontWeight: "800" },
  name: { color: "#fff", fontWeight: "700", fontSize: 14 },
  gradePill: { paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  gradeTxt: { fontWeight: "800", fontSize: 12 },
  pdfBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(53,167,255,0.15)", alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  label: { color: DARK.sub, fontSize: 12, fontWeight: "700", marginTop: SPACING.md, marginBottom: 6, textTransform: "uppercase" },
  input: { height: 46, borderRadius: RADIUS.md, backgroundColor: DARK.input, color: "#fff", paddingHorizontal: SPACING.md, fontSize: 15, borderWidth: 1, borderColor: DARK.border },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: SPACING.sm },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#1F6BFF", borderColor: "#1F6BFF" },
  chipTxt: { color: DARK.sub, fontSize: 13, fontWeight: "600" },
  saveBtn: { height: 50, borderRadius: RADIUS.md, backgroundColor: "#1F6BFF", alignItems: "center", justifyContent: "center", marginTop: SPACING.lg },
  saveTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  markRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.sm, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: RADIUS.md },
  markInput: { width: 76, height: 40, borderRadius: 10, backgroundColor: DARK.input, color: "#fff", textAlign: "center", fontSize: 16, fontWeight: "700", borderWidth: 1, borderColor: DARK.border },
});
