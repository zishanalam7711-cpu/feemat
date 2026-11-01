import React, { useState } from "react";
import { ActivityIndicator, Alert, Image as RNImage, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { pickAndUploadImage, pickAndUploadPdf, Uploaded } from "@/src/lib/aiFiles";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { AIRobot } from "@/src/components/AIRobot";

// "Check work": the teacher photographs a student's homework or answer sheet, the paid (private) AI reads it and returns
// marks, mistakes and feedback. For answer sheets with a student + exam chosen, the marks are only PREPARED; the teacher taps Confirm to save.

type Kind = "homework" | "paper";

export function AICheckWork({ visible, onClose, bottomInset, powerReady }: { visible: boolean; onClose: () => void; bottomInset: number; powerReady: boolean }) {
  const [kind, setKind] = useState<Kind>("homework");
  const [student, setStudent] = useState("");
  const [exam, setExam] = useState("");
  const [outOf, setOutOf] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState("");
  const [act, setAct] = useState<{ st: string; text?: string }>({ st: "" });

  const reset = () => { setFiles([]); setRes(null); setErr(""); setAct({ st: "" }); setNotes(""); };
  const close = () => { reset(); onClose(); };

  const add = async (src: "camera" | "gallery" | "pdf") => {
    if (files.length >= 4) { Alert.alert("Limit reached", "You can add up to 4 pages."); return; }
    setUploading(true);
    try {
      const f = src === "pdf" ? await pickAndUploadPdf() : await pickAndUploadImage(src);
      if (f) setFiles((p) => [...p, f]);
    } catch (e: any) { Alert.alert("Could not add", e?.message || "Please try again."); }
    finally { setUploading(false); }
  };
  const removeFile = async (f: Uploaded) => { setFiles((p) => p.filter((x) => x.id !== f.id)); try { await api(`/ai/files/${f.id}`, { method: "DELETE" }); } catch {} };

  const run = async () => {
    if (!files.length || busy) return;
    setBusy(true); setErr(""); setRes(null); setAct({ st: "" });
    try {
      const n = parseFloat(outOf);
      const r = await api("/ai/check-work", { method: "POST", body: { kind, file_ids: files.map((f) => f.id), student_name: student.trim(), exam_title: kind === "paper" ? exam.trim() : "", out_of: isFinite(n) && n > 0 ? n : null, instructions: notes.trim() } });
      setRes(r);
    } catch (e: any) { setErr(e?.message || "Could not check this work."); }
    finally { setBusy(false); }
  };

  const confirm = async (ok: boolean) => {
    if (!res?.action) return;
    setAct({ st: "busy" });
    try { await api(`/ai/actions/${res.action.id}/${ok ? "confirm" : "cancel"}`, { method: "POST" }); setAct({ st: ok ? "done" : "cancelled" }); }
    catch (e: any) { setAct({ st: "error", text: e?.message || "Failed" }); }
  };

  return (
    <InlineOverlay visible={visible} onClose={close}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={close} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}>
            <AIRobot size={40} animated={false} />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Check work with AI</Text>
              <Text style={s.sub}>Photo of homework or answer sheet</Text>
            </View>
            <Pressable onPress={close} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable>
          </View>

          {!powerReady ? (
            <View style={s.warn}><Ionicons name="alert-circle" size={18} color="#B45309" /><Text style={s.warnTxt}>This needs Power mode (paid private AI). Ask the app owner to switch on AI_PAID_ENABLED and set a monthly budget.</Text></View>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 560 }}>
              <View style={s.seg}>
                {(["homework", "paper"] as Kind[]).map((k) => (
                  <Pressable key={k} onPress={() => setKind(k)} style={[s.segBtn, kind === k && s.segOn]}>
                    <Text style={[s.segTxt, kind === k && { color: "#fff" }]}>{k === "homework" ? "Homework" : "Answer sheet"}</Text>
                  </Pressable>
                ))}
              </View>

              <TextInput value={student} onChangeText={setStudent} placeholder="Student name (optional)" placeholderTextColor="#94A3B8" style={s.input} />
              {kind === "paper" ? <TextInput value={exam} onChangeText={setExam} placeholder="Exam title, to save marks (optional)" placeholderTextColor="#94A3B8" style={s.input} /> : null}
              <TextInput value={outOf} onChangeText={setOutOf} placeholder="Total marks (e.g. 10)" placeholderTextColor="#94A3B8" keyboardType="numeric" style={s.input} />
              <TextInput value={notes} onChangeText={setNotes} placeholder="Answer key / what to check (optional)" placeholderTextColor="#94A3B8" multiline style={[s.input, { minHeight: 64, textAlignVertical: "top" }]} />

              <View style={s.addRow}>
                <Pressable onPress={() => add("camera")} style={s.addBtn}><Ionicons name="camera" size={18} color="#1F6BFF" /><Text style={s.addTxt}>Camera</Text></Pressable>
                <Pressable onPress={() => add("gallery")} style={s.addBtn}><Ionicons name="image" size={18} color="#1F6BFF" /><Text style={s.addTxt}>Gallery</Text></Pressable>
                <Pressable onPress={() => add("pdf")} style={s.addBtn}><Ionicons name="document" size={18} color="#1F6BFF" /><Text style={s.addTxt}>PDF</Text></Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
                {files.map((f) => (
                  <View key={f.id} style={s.fileChip}>
                    {f.preview ? <RNImage source={{ uri: f.preview }} style={s.thumb} /> : <Ionicons name="document" size={20} color="#1F6BFF" />}
                    <Pressable onPress={() => removeFile(f)} hitSlop={8}><Ionicons name="close-circle" size={18} color="#94A3B8" /></Pressable>
                  </View>
                ))}
                {uploading ? <View style={s.fileChip}><ActivityIndicator size="small" color="#1F6BFF" /></View> : null}
              </ScrollView>

              <Pressable onPress={run} disabled={!files.length || busy} style={[s.go, (!files.length || busy) && { opacity: 0.45 }]}>
                {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="sparkles" size={18} color="#fff" /><Text style={s.goTxt}>Check now</Text></>}
              </Pressable>
              {err ? <Text style={s.err}>{err}</Text> : null}

              {res ? (
                <View style={s.card}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={s.scoreBox}><Text style={s.score}>{res.score % 1 === 0 ? res.score : res.score.toFixed(1)}<Text style={s.scoreOf}> / {res.out_of}</Text></Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.pct}>{res.percentage}%  ·  Grade {res.grade}</Text>
                      <Text style={s.meta}>{[res.student, res.exam].filter(Boolean).join("  ·  ") || (kind === "homework" ? "Homework" : "Answer sheet")}</Text>
                    </View>
                  </View>
                  {res.summary ? <Text style={s.body}>{res.summary}</Text> : null}
                  {(res.mistakes || []).length ? <Text style={s.lbl}>Mistakes</Text> : null}
                  {(res.mistakes || []).map((m: any, i: number) => (
                    <Text key={i} style={s.body}>• <Text style={{ fontWeight: "800" }}>{m.item}</Text>{m.problem ? `: ${m.problem}` : ""}{m.fix ? `  ➜ ${m.fix}` : ""}</Text>
                  ))}
                  {res.feedback_for_student ? (<><Text style={s.lbl}>Note for student</Text><Text style={s.body}>{res.feedback_for_student}</Text></>) : null}
                  {res.feedback_for_parent ? (<><Text style={s.lbl}>Note for parent</Text><Text style={s.body}>{res.feedback_for_parent}</Text></>) : null}
                  {(res.unreadable || []).length ? <Text style={s.warnSmall}>Hard to read: {res.unreadable.join(", ")}</Text> : null}
                  <Text style={s.note}>{res.note}</Text>

                  {res.action ? (
                    <View style={s.action}>
                      <Text style={s.actLbl}>Needs your confirmation</Text>
                      <Text style={s.actTxt}>{res.action.summary}</Text>
                      {act.st === "done" ? <Text style={s.ok}>Saved ✓</Text> : act.st === "cancelled" ? <Text style={s.meta}>Cancelled</Text> : act.st === "busy" ? <ActivityIndicator color="#1F6BFF" /> : (
                        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                          <Pressable onPress={() => confirm(true)} style={s.confirm}><Text style={s.confirmTxt}>Save marks</Text></Pressable>
                          <Pressable onPress={() => confirm(false)} style={s.cancel}><Text style={s.cancelTxt}>Cancel</Text></Pressable>
                        </View>
                      )}
                      {act.st === "error" ? <Text style={s.err}>{act.text}</Text> : null}
                    </View>
                  ) : kind === "paper" ? <Text style={s.note}>Add the student name and exam title to save these marks in one tap.</Text> : null}
                </View>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </InlineOverlay>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 12, color: "#64748B" },
  warn: { flexDirection: "row", gap: 8, backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12 },
  warnTxt: { flex: 1, color: "#92400E", fontSize: 12, lineHeight: 17 },
  seg: { flexDirection: "row", backgroundColor: "#EEF4FF", borderRadius: 14, padding: 3, marginBottom: 8 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 11 },
  segOn: { backgroundColor: "#1F6BFF" },
  segTxt: { fontWeight: "800", color: "#1F6BFF", fontSize: 13 },
  input: { backgroundColor: "#F4F8FF", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#0F172A", marginTop: 8 },
  addRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  addBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: "#BFD7FF", backgroundColor: "#fff" },
  addTxt: { color: "#1F6BFF", fontWeight: "800", fontSize: 13 },
  fileChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#EEF4FF", borderRadius: 14, paddingHorizontal: 8, paddingVertical: 6 },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  go: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, borderRadius: 14, backgroundColor: "#1F6BFF", marginTop: 4 },
  goTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  err: { color: "#B91C1C", fontSize: 13, marginTop: 8 },
  card: { backgroundColor: "#F8FBFF", borderWidth: 1, borderColor: "#DCE6F7", borderRadius: 16, padding: 14, marginTop: 12, gap: 4 },
  scoreBox: { backgroundColor: "#1F6BFF", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  score: { color: "#fff", fontSize: 24, fontWeight: "900" },
  scoreOf: { fontSize: 14, fontWeight: "700", color: "#CFE0FF" },
  pct: { color: "#0F172A", fontSize: 16, fontWeight: "800" },
  meta: { color: "#64748B", fontSize: 12, marginTop: 2 },
  body: { color: "#0F172A", fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  lbl: { color: "#1F6BFF", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 10 },
  warnSmall: { color: "#B45309", fontSize: 12, marginTop: 8 },
  note: { color: "#64748B", fontSize: 11.5, lineHeight: 16, marginTop: 8 },
  action: { backgroundColor: "#FFFBEB", borderWidth: 1, borderColor: "#FCD34D", borderRadius: 14, padding: 12, marginTop: 10 },
  actLbl: { color: "#B45309", fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  actTxt: { color: "#0F172A", fontSize: 14, fontWeight: "600", marginTop: 4 },
  ok: { color: "#16A34A", fontWeight: "800", marginTop: 8 },
  confirm: { backgroundColor: "#16A34A", borderRadius: 12, paddingHorizontal: 18, height: 40, alignItems: "center", justifyContent: "center" },
  confirmTxt: { color: "#fff", fontWeight: "800" },
  cancel: { backgroundColor: "#fff", borderRadius: 12, paddingHorizontal: 18, height: 40, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#CBD5E1" },
  cancelTxt: { color: "#475569", fontWeight: "800" },
});
