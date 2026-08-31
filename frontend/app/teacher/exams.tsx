import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";

export default function Exams() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showMarks, setShowMarks] = useState<any>(null);
  const [marksMap, setMarksMap] = useState<Record<string, string>>({});

  // create form
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [total, setTotal] = useState("100");
  const [pass, setPass] = useState("35");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, s] = await Promise.all([api("/teacher/exams"), api("/teacher/students?limit=200")]);
      setItems(e as any); setStudents((s as any).items || []);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api("/teacher/exams", { method: "POST", body: { title, subject, total_marks: parseFloat(total), passing_marks: parseFloat(pass), exam_date: date } });
      setShowNew(false); setTitle(""); setSubject(""); setTotal("100"); setPass("35");
      await load();
    } catch {} finally { setBusy(false); }
  };

  const openMarks = async (e: any) => {
    try {
      const existing = await api<any[]>(`/teacher/exams/${e.id}/marks`);
      const m: Record<string, string> = {};
      existing.forEach((x) => (m[x.student_user_id] = String(x.marks)));
      setMarksMap(m);
      setShowMarks(e);
    } catch {}
  };

  const saveMarks = async () => {
    setBusy(true);
    try {
      const entries = Object.entries(marksMap)
        .filter(([, v]) => v !== "" && !isNaN(parseFloat(v)))
        .map(([student_user_id, v]) => ({ student_user_id, marks: parseFloat(v) }));
      await api(`/teacher/exams/${showMarks.id}/marks`, { method: "POST", body: { entries } });
      setShowMarks(null);
    } catch {} finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Exams & Results</Text>
        <Pressable testID="new-exam-btn" onPress={() => setShowNew(true)} hitSlop={12}><Ionicons name="add-circle" size={26} color={COLORS.brand} /></Pressable>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View> :
       items.length === 0 ? <View style={styles.center}><Ionicons name="document-text-outline" size={56} color={COLORS.borderStrong} /><Text style={styles.emptyTxt}>No exams yet.</Text></View> :
       <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
         {items.map((e) => (
           <Pressable key={e.id} style={styles.card} onPress={() => openMarks(e)} testID={`exam-${e.id}`}>
             <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
               <View style={styles.icnWrap}><Ionicons name="document-text" size={20} color={COLORS.brand} /></View>
               <View style={{ flex: 1 }}>
                 <Text style={styles.title}>{e.title}</Text>
                 <Text style={styles.meta}>{e.subject || "General"} • Total {e.total_marks} • Pass {e.passing_marks}</Text>
                 <Text style={styles.meta}>{e.exam_date}</Text>
               </View>
               <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
             </View>
           </Pressable>
         ))}
       </ScrollView>}

      <Modal transparent visible={showNew} animationType="slide" onRequestClose={() => setShowNew(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Exam</Text>
            <Input testID="e-title" label="Title" value={title} onChangeText={setTitle} placeholder="Mid-term Math" />
            <Input testID="e-subject" label="Subject" value={subject} onChangeText={setSubject} />
            <View style={{ flexDirection: "row", gap: SPACING.md }}>
              <View style={{ flex: 1 }}><Input label="Total marks" value={total} onChangeText={setTotal} keyboardType="decimal-pad" /></View>
              <View style={{ flex: 1 }}><Input label="Passing marks" value={pass} onChangeText={setPass} keyboardType="decimal-pad" /></View>
            </View>
            <Input testID="e-date" label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} />
            <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
              <Button title="Cancel" variant="secondary" onPress={() => setShowNew(false)} style={{ flex: 1 }} />
              <Button testID="e-save" title="Create" onPress={create} loading={busy} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal transparent visible={!!showMarks} animationType="slide" onRequestClose={() => setShowMarks(null)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modalCard, { maxHeight: "85%" }]}>
            <Text style={styles.modalTitle}>Enter Marks — {showMarks?.title}</Text>
            <Text style={styles.meta}>Total: {showMarks?.total_marks} • Passing: {showMarks?.passing_marks}</Text>
            <ScrollView style={{ marginTop: SPACING.md }} contentContainerStyle={{ gap: SPACING.sm }}>
              {students.map((c: any) => (
                <View key={c.id} style={styles.markRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "700", color: COLORS.onSurface }}>{c.student?.name}</Text>
                    <Text style={{ color: COLORS.muted, fontSize: 12 }}>{c.admission_number}</Text>
                  </View>
                  <Input
                    testID={`marks-${c.student_user_id}`}
                    value={marksMap[c.student_user_id] || ""}
                    onChangeText={(v) => setMarksMap((p) => ({ ...p, [c.student_user_id]: v }))}
                    keyboardType="decimal-pad"
                    placeholder="—"
                    style={{ width: 80, textAlign: "center" }}
                  />
                </View>
              ))}
            </ScrollView>
            <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
              <Button title="Close" variant="secondary" onPress={() => setShowMarks(null)} style={{ flex: 1 }} />
              <Button testID="save-marks" title="Save & Notify" onPress={saveMarks} loading={busy} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  emptyTxt: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  icnWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.brandSoft },
  title: { fontSize: 15, fontWeight: "800", color: COLORS.onSurface },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  modalWrap: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: COLORS.surface, padding: SPACING.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: SPACING.md, paddingBottom: SPACING.xxl },
  modalTitle: { fontSize: 20, fontWeight: "800", color: COLORS.onSurface, marginBottom: SPACING.sm },
  markRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.sm, backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md },
});
