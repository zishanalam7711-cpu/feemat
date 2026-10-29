import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Switch, Image as RNImage } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { pickAndUploadImage, Uploaded } from "@/src/lib/aiFiles";
import { GradientBg, GradBtn } from "@/src/components/ui";

type Status = "present" | "absent" | "late" | "leave" | "not_observed";
const OPTIONS: { k: Status; l: string; c: string }[] = [
  { k: "present", l: "P", c: "#16A34A" },
  { k: "absent", l: "A", c: "#EF4444" },
  { k: "late", l: "Late", c: "#F59E0B" },
  { k: "leave", l: "Leave", c: "#2E8BFF" },
  { k: "not_observed", l: "Skip", c: "#94A3B8" },
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function AiAttendance() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [step, setStep] = useState<"setup" | "review" | "done">("setup");
  const [status, setStatus] = useState<any>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [classId, setClassId] = useState<string | undefined>();
  const [batchId, setBatchId] = useState<string | undefined>();
  const [date, setDate] = useState(ymd(new Date()));
  const [photo, setPhoto] = useState<Uploaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [dec, setDec] = useState<Record<string, Status>>({});
  const [result, setResult] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [s, c, b]: any = await Promise.all([api("/ai/status"), api("/teacher/classes").catch(() => []), api("/teacher/batches").catch(() => [])]);
      setStatus(s); setClasses(c || []); setBatches(b || []);
    } catch (e: any) { setStatus({ error: e?.message || "AI is not available." }); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const take = async (src: "camera" | "gallery") => {
    setBusy(true);
    try { const f = await pickAndUploadImage(src); if (f) setPhoto(f); }
    catch (e: any) { Alert.alert("Could not use this photo", e?.message || "Please try again."); }
    finally { setBusy(false); }
  };

  const setConsent = async (v: boolean) => {
    if (v) {
      Alert.alert(
        "Turn on face matching?",
        "The AI compares your class photo with the students' profile photos and only SUGGESTS who is present. You confirm every student. Children's photos are processed by an AI provider. Turn this on only if parents/guardians have agreed and you are allowed to do this.",
        [{ text: "Cancel", style: "cancel" }, { text: "I agree, turn on", onPress: async () => { try { await api("/ai/attendance/settings", { method: "PUT", body: { consent: true } }); load(); } catch (e: any) { Alert.alert("Not turned on", e?.message || ""); } } }]
      );
    } else { try { await api("/ai/attendance/settings", { method: "PUT", body: { consent: false } }); load(); } catch {} }
  };

  const analyze = async () => {
    if (!photo) { Alert.alert("Add a class photo", "Take or choose a photo of the class first."); return; }
    setBusy(true);
    try {
      const s: any = await api("/ai/attendance/photo", { method: "POST", body: { file_id: photo.id, class_id: classId, batch_id: batchId, date } });
      setSession(s);
      const d: Record<string, Status> = {};
      s.roster.forEach((r: any) => { d[r.connection_id] = r.suggested === "present" ? "present" : "not_observed"; });
      setDec(d);
      setStep("review");
    } catch (e: any) { Alert.alert("Could not analyze", e?.message || "Please try again."); }
    finally { setBusy(false); }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { present: 0, absent: 0, late: 0, leave: 0, not_observed: 0 };
    Object.values(dec).forEach((v) => { c[v] += 1; });
    return c;
  }, [dec]);

  const save = () => {
    const toSave = counts.present + counts.absent + counts.late + counts.leave;
    Alert.alert(
      "Save attendance?",
      `${toSave} students will be saved. ${counts.not_observed} students are skipped and will NOT be marked absent.`,
      [{ text: "Cancel", style: "cancel" }, { text: "Save", onPress: async () => {
        setBusy(true);
        try {
          const r: any = await api(`/ai/attendance/session/${session.id}/confirm`, { method: "POST", body: { decisions: Object.entries(dec).map(([connection_id, status]) => ({ connection_id, status })) } });
          setResult(r); setStep("done");
        } catch (e: any) { Alert.alert("Could not save", e?.message || "Please try again."); }
        finally { setBusy(false); }
      } }]
    );
  };

  const header = (
    <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
      <Pressable onPress={() => (step === "review" ? setStep("setup") : router.back())} hitSlop={12}><Ionicons name="arrow-back" size={26} color="#fff" /></Pressable>
      <Text style={styles.title}>AI Photo Attendance</Text>
      <View style={{ width: 26 }} />
    </View>
  );

  const face = status?.face;
  const priv = status?.providers?.some((p: any) => p.configured && p.private);

  // ------------------------------------------------------------ done
  if (step === "done" && result) {
    return (
      <GradientBg>
        {header}
        <ScrollView style={styles.panel} contentContainerStyle={{ padding: 18, gap: 14 }}>
          <View style={styles.okCard}>
            <Ionicons name="checkmark-circle" size={54} color="#16A34A" />
            <Text style={styles.h}>Attendance saved</Text>
            <Text style={styles.p}>{date}</Text>
          </View>
          <View style={styles.grid}>
            {OPTIONS.map((o) => <View key={o.k} style={styles.stat}><Text style={[styles.statV, { color: o.c }]}>{result.counts[o.k] ?? 0}</Text><Text style={styles.statL}>{o.k === "not_observed" ? "Not marked" : o.l === "P" ? "Present" : o.l === "A" ? "Absent" : o.l}</Text></View>)}
          </View>
          <View style={styles.warnBox}><Ionicons name="information-circle" size={18} color="#B45309" /><Text style={styles.warnTxt}>{result.note}</Text></View>
          {result.not_marked?.length ? (
            <View style={styles.card}>
              <Text style={styles.label}>Not marked ({result.not_marked.length})</Text>
              <Text style={styles.p}>{result.not_marked.join(", ")}</Text>
              <Text style={styles.small}>Open the Attendance screen to mark them yourself (for example as absent).</Text>
            </View>
          ) : null}
          <GradBtn title="Open Attendance" icon="calendar" onPress={() => router.replace("/teacher/attendance" as any)} />
          <Pressable onPress={() => { setStep("setup"); setPhoto(null); setSession(null); setResult(null); }} style={styles.outline}><Text style={styles.outlineTxt}>Take another photo</Text></Pressable>
        </ScrollView>
      </GradientBg>
    );
  }

  // ------------------------------------------------------------ review
  if (step === "review" && session) {
    const q = session.quality || {};
    const ai = q.ai;
    const marked = counts.present + counts.late;
    return (
      <GradientBg>
        {header}
        <View style={styles.panel}>
          <ScrollView contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: 120 }}>
            <View style={[styles.banner, { backgroundColor: q.good === false ? "#FEF3C7" : "#DCFCE7" }]}>
              <Ionicons name={q.good === false ? "alert-circle" : "checkmark-circle"} size={20} color={q.good === false ? "#B45309" : "#16A34A"} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>{q.good === false ? "This photo may not be good enough" : "Photo looks fine"}</Text>
                {(q.issues || []).map((i: string, k: number) => <Text key={k} style={styles.small}>• {i}</Text>)}
                {ai?.people_visible != null ? <Text style={styles.small}>AI counted about {ai.people_visible} people in the photo; you have marked {marked} present/late.</Text> : null}
              </View>
              {q.good === false ? <Pressable onPress={() => setStep("setup")} style={styles.retake}><Text style={styles.retakeTxt}>Retake</Text></Pressable> : null}
            </View>
            {(session.notes || []).map((n: string, k: number) => <Text key={k} style={styles.note}>ℹ️ {n}</Text>)}
            <Text style={styles.note}>Only students you set below are saved. "Skip" means not marked, never absent.</Text>

            {session.roster.map((r: any) => {
              const cur = dec[r.connection_id];
              const unsure = r.suggested === "uncertain";
              return (
                <View key={r.connection_id} style={[styles.row, unsure && { borderColor: "#F59E0B", borderWidth: 1.5 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{r.name}</Text>
                      <Text style={styles.small}>{r.admission_number}{r.existing ? `  •  already saved: ${r.existing}` : ""}{r.auto_saved ? "  •  saved automatically" : ""}</Text>
                    </View>
                    {r.suggested === "present" ? <Tag c="#16A34A" t={`AI: present ${Math.round((r.confidence || 0) * 100)}%`} /> :
                      unsure ? <Tag c="#B45309" t={`Check ${Math.round((r.confidence || 0) * 100)}%`} /> : <Tag c="#94A3B8" t="Not seen" />}
                  </View>
                  {unsure ? <Text style={styles.ask}>The AI is not sure this is {r.name}. Mark present only if you can confirm.</Text> : null}
                  <View style={styles.opts}>
                    {OPTIONS.map((o) => (
                      <Pressable key={o.k} onPress={() => setDec((d) => ({ ...d, [r.connection_id]: o.k }))} style={[styles.opt, { borderColor: o.c }, cur === o.k && { backgroundColor: o.c }]}>
                        <Text style={[styles.optTxt, { color: cur === o.k ? "#fff" : o.c }]}>{o.l}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <View style={[styles.bar, { paddingBottom: insets.bottom + 10 }]}>
            <Text style={styles.small}>Present {counts.present} • Absent {counts.absent} • Late {counts.late} • Leave {counts.leave} • Skipped {counts.not_observed}</Text>
            <GradBtn title="Save attendance" onPress={save} loading={busy} style={{ marginTop: 8 }} />
          </View>
        </View>
      </GradientBg>
    );
  }

  // ------------------------------------------------------------ setup
  return (
    <GradientBg>
      {header}
      <ScrollView style={styles.panel} contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {!status ? <ActivityIndicator color="#1F6BFF" /> : null}
        {status?.error ? <View style={styles.warnBox}><Ionicons name="alert-circle" size={18} color="#B45309" /><Text style={styles.warnTxt}>{status.error}</Text></View> : null}
        <View style={styles.infoBox}>
          <Ionicons name="shield-checkmark" size={20} color="#1F6BFF" />
          <Text style={styles.infoTxt}>Take one photo of the class. You review the list and confirm every student. Students not seen in the photo are never marked absent automatically.</Text>
        </View>

        <Text style={styles.label}>1. Class or batch</Text>
        <View style={styles.wrap}>
          <Chip l="All students" on={!classId && !batchId} onPress={() => { setClassId(undefined); setBatchId(undefined); }} />
          {classes.map((c) => <Chip key={c.id} l={c.name} on={classId === c.id} onPress={() => setClassId(classId === c.id ? undefined : c.id)} />)}
          {batches.map((b) => <Chip key={b.id} l={b.name} on={batchId === b.id} onPress={() => setBatchId(batchId === b.id ? undefined : b.id)} />)}
        </View>

        <Text style={styles.label}>2. Date</Text>
        <View style={styles.wrap}>
          <Chip l="Today" on={date === ymd(new Date())} onPress={() => setDate(ymd(new Date()))} />
          <Chip l="Yesterday" on={date === ymd(new Date(Date.now() - 86400000))} onPress={() => setDate(ymd(new Date(Date.now() - 86400000)))} />
          <Text style={[styles.small, { alignSelf: "center" }]}>{date}</Text>
        </View>

        <Text style={styles.label}>3. Class photo</Text>
        {photo ? (
          <View style={styles.card}>
            {photo.preview ? <RNImage source={{ uri: photo.preview }} style={styles.preview} resizeMode="cover" /> : null}
            <Text style={styles.small}>Tip: take it from the front so every face is visible, in good light, holding the phone steady.</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable onPress={() => take("camera")} disabled={busy} style={[styles.pick, busy && { opacity: 0.5 }]}><Ionicons name="camera" size={22} color="#1F6BFF" /><Text style={styles.pickTxt}>Take photo</Text></Pressable>
          <Pressable onPress={() => take("gallery")} disabled={busy} style={[styles.pick, busy && { opacity: 0.5 }]}><Ionicons name="image" size={22} color="#1F6BFF" /><Text style={styles.pickTxt}>Gallery</Text></Pressable>
        </View>

        <Text style={styles.label}>Face matching</Text>
        {face?.server_enabled ? (
          <View style={styles.card}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>Let AI suggest who is present</Text>
                <Text style={styles.small}>Uses students' profile photos. Only suggestions, you confirm each student.{!priv ? " Needs a private AI provider, which is not set up yet." : ""}</Text>
              </View>
              <Switch value={!!face.consent} onValueChange={setConsent} />
            </View>
          </View>
        ) : (
          <View style={styles.card}><Text style={styles.small}>Face matching is switched off by the app owner. You mark attendance yourself, using the photo as a guide. This keeps children's faces private.</Text></View>
        )}

        <GradBtn title="Analyze photo" icon="sparkles" onPress={analyze} loading={busy} disabled={!photo} style={{ marginTop: 6 }} />
        <Pressable onPress={() => router.push("/teacher/attendance" as any)} style={styles.outline}><Text style={styles.outlineTxt}>Mark attendance without a photo</Text></Pressable>
      </ScrollView>
    </GradientBg>
  );
}

function Chip({ l, on, onPress }: { l: string; on: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}><Text style={[styles.chipTxt, on && { color: "#fff" }]}>{l}</Text></Pressable>;
}
function Tag({ c, t }: { c: string; t: string }) {
  return <View style={[styles.tag, { backgroundColor: c + "22" }]}><Text style={[styles.tagTxt, { color: c }]}>{t}</Text></View>;
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingBottom: 14 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  panel: { flex: 1, backgroundColor: "#F4F8FF", borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  infoBox: { flexDirection: "row", gap: 10, backgroundColor: "#DBEAFE", borderRadius: 14, padding: 12 },
  infoTxt: { flex: 1, color: "#1E3A8A", fontSize: 12, lineHeight: 18 },
  label: { color: "#1F6BFF", fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: "#fff", borderWidth: 1, borderColor: "#DCE6F7", alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#1F6BFF", borderColor: "#1F6BFF" },
  chipTxt: { color: "#475569", fontWeight: "700", fontSize: 13 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 14, gap: 8 },
  preview: { width: "100%", height: 190, borderRadius: 12, backgroundColor: "#E8EFFB" },
  pick: { flex: 1, height: 54, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1.5, borderColor: "#1F6BFF", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  pickTxt: { color: "#1F6BFF", fontWeight: "800" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: "#0F172A", fontWeight: "700", fontSize: 14 },
  small: { color: "#64748B", fontSize: 12, lineHeight: 17 },
  p: { color: "#0F172A", fontSize: 14, lineHeight: 20 },
  h: { color: "#0F172A", fontSize: 20, fontWeight: "800" },
  note: { color: "#64748B", fontSize: 12, lineHeight: 17 },
  outline: { height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: "#1F6BFF", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  outlineTxt: { color: "#1F6BFF", fontWeight: "800" },
  banner: { flexDirection: "row", gap: 10, borderRadius: 14, padding: 12, alignItems: "flex-start" },
  bannerTitle: { color: "#0F172A", fontWeight: "800", fontSize: 14 },
  retake: { paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: "#1F6BFF", alignItems: "center", justifyContent: "center" },
  retakeTxt: { color: "#fff", fontWeight: "800", fontSize: 12 },
  row: { backgroundColor: "#fff", borderRadius: 14, padding: 12, gap: 8 },
  ask: { color: "#B45309", fontSize: 12, fontWeight: "600" },
  tag: { paddingHorizontal: 8, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  tagTxt: { fontSize: 11, fontWeight: "800" },
  opts: { flexDirection: "row", gap: 6 },
  opt: { flex: 1, height: 34, borderRadius: 9, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  optTxt: { fontSize: 12, fontWeight: "800" },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: "#fff", padding: 12, borderTopWidth: 1, borderTopColor: "#E8EFFB" },
  okCard: { alignItems: "center", backgroundColor: "#fff", borderRadius: 18, padding: 20, gap: 4 },
  grid: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, backgroundColor: "#fff", borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  statV: { fontSize: 20, fontWeight: "800" },
  statL: { color: "#64748B", fontSize: 10, marginTop: 2, textAlign: "center" },
  warnBox: { flexDirection: "row", gap: 8, backgroundColor: "#FEF3C7", borderRadius: 12, padding: 12 },
  warnTxt: { flex: 1, color: "#92400E", fontSize: 12, lineHeight: 17 },
});
