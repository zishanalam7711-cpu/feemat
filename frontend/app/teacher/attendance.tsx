import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, Alert, TextInput, Linking, Share, ScrollView,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";

const DARK = {
  bg: "#120A28",
  card: "#1E1440",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  input: "rgba(255,255,255,0.07)",
};

type Status = "present" | "absent" | "late" | "leave";
const STATUSES: { key: Status; label: string; color: string }[] = [
  { key: "present", label: "P", color: "#10B981" },
  { key: "absent", label: "A", color: "#EF4444" },
  { key: "late", label: "Late", color: "#F59E0B" },
  { key: "leave", label: "Leave", color: "#3B82F6" },
];

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const todayStr = () => new Date().toISOString().slice(0, 10);
function addDays(d: string, n: number) {
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function addMonths(m: string, n: number) {
  const [y, mo] = m.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + n, 1));
  return dt.toISOString().slice(0, 7);
}
function dateLabel(d: string) {
  const t = todayStr();
  const dt = new Date(d + "T00:00:00Z");
  const base = `${DAYS[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
  if (d === t) return `Today • ${base}`;
  if (d === addDays(t, -1)) return `Yesterday • ${base}`;
  return base;
}
function monthLabel(m: string) {
  const [y, mo] = m.split("-").map(Number);
  return `${MONTHS[mo - 1]} ${y}`;
}
function waNumber(phone?: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return "91" + digits;
  return digits;
}

export default function AttendanceScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<"mark" | "report">("mark");

  // ---- mark tab state
  const [date, setDate] = useState(todayStr());
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [q, setQ] = useState("");
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [saved, setSaved] = useState<Record<string, Status>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ---- report tab state
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [report, setReport] = useState<any>(null);
  const [repLoading, setRepLoading] = useState(false);

  const loadStudents = useCallback(async () => {
    try {
      const [s, c]: any = await Promise.all([api("/teacher/students?filter=all&limit=200"), api("/teacher/classes")]);
      setStudents(s.items || []);
      setClasses(c || []);
    } catch {}
  }, []);

  const loadMarks = useCallback(async () => {
    setLoading(true);
    try {
      const res: any = await api(`/teacher/attendance?date=${date}`);
      setMarks(res || {});
      setSaved(res || {});
    } catch {
      setMarks({});
      setSaved({});
    }
    setLoading(false);
  }, [date]);

  useFocusEffect(useCallback(() => { loadStudents(); }, [loadStudents]));
  useEffect(() => { loadMarks(); }, [loadMarks]);

  const loadReport = useCallback(async () => {
    setRepLoading(true);
    try { setReport(await api(`/teacher/attendance/report?month=${month}`)); } catch { setReport(null); }
    setRepLoading(false);
  }, [month]);
  useEffect(() => { if (tab === "report") loadReport(); }, [tab, loadReport]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return students.filter((s) => {
      if (classId && s.class_id !== classId) return false;
      if (!qq) return true;
      return (s.student?.name || "").toLowerCase().includes(qq) || String(s.admission_number || "").toLowerCase().includes(qq);
    });
  }, [students, classId, q]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, leave: 0, none: 0 };
    filtered.forEach((s) => {
      const m = marks[s.id];
      if (m) c[m] += 1; else c.none += 1;
    });
    return c;
  }, [filtered, marks]);

  const changed = useMemo(() => Object.keys(marks).filter((id) => marks[id] !== saved[id]), [marks, saved]);

  const setOne = (id: string, st: Status) => setMarks((p) => ({ ...p, [id]: st }));
  const allPresent = () => {
    setMarks((p) => {
      const n = { ...p };
      filtered.forEach((s) => { if (!n[s.id]) n[s.id] = "present"; });
      return n;
    });
  };
  const markAllUnmarkedPresentHint = counts.none;

  const save = async () => {
    if (changed.length === 0) { Alert.alert("Nothing changed", "Mark or change at least one student's attendance first."); return; }
    setSaving(true);
    try {
      await Promise.all(changed.map((id) => api(`/connections/${id}/attendance`, { method: "POST", body: { date, status: marks[id] } })));
      setSaved({ ...marks });
      Alert.alert("Saved", `Attendance saved for ${changed.length} students.`);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Could not save. Please try again.");
    }
    setSaving(false);
  };

  const whatsappAbsent = (s: any) => {
    const num = waNumber(s.student?.phone);
    if (!num) { Alert.alert("No phone number", "This student has no phone number saved."); return; }
    const msg = `Hello, ${s.student?.name || "your child"} was absent from class on ${date}. Please take note.`;
    Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`).catch(() => {});
  };

  const shareReport = async () => {
    if (!report) return;
    const lines = (report.items || []).map((i: any) => `${i.name}: ${i.pct}% (P${i.present} A${i.absent} L${i.late} Lv${i.leave})`);
    await Share.share({ message: `Attendance Report — ${monthLabel(month)}\n\n${lines.join("\n")}` });
  };

  const avgPct = useMemo(() => {
    const it = (report?.items || []).filter((i: any) => i.total > 0);
    if (!it.length) return 0;
    return Math.round((it.reduce((a: number, i: any) => a + i.pct, 0) / it.length) * 10) / 10;
  }, [report]);

  const isToday = date >= todayStr();

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={styles.title}>Attendance</Text>
      </View>

      <View style={styles.tabs}>
        {(["mark", "report"] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tabBtn, tab === t && styles.tabOn]}>
            <Text style={[styles.tabTxt, tab === t && { color: "#fff" }]}>{t === "mark" ? "Mark" : "Monthly Report"}</Text>
          </Pressable>
        ))}
      </View>

      {tab === "mark" ? (
        <>
          <View style={styles.dateRow}>
            <Pressable onPress={() => setDate(addDays(date, -1))} hitSlop={10} style={styles.navBtn}><Ionicons name="chevron-back" size={20} color="#fff" /></Pressable>
            <Pressable onPress={() => setDate(todayStr())} style={{ flex: 1, alignItems: "center" }}>
              <Text style={styles.dateTxt}>{dateLabel(date)}</Text>
            </Pressable>
            <Pressable onPress={() => !isToday && setDate(addDays(date, 1))} hitSlop={10} style={[styles.navBtn, isToday && { opacity: 0.3 }]}><Ionicons name="chevron-forward" size={20} color="#fff" /></Pressable>
          </View>

          <View style={styles.summary}>
            <Sum label="Present" v={counts.present} color="#10B981" />
            <Sum label="Absent" v={counts.absent} color="#EF4444" />
            <Sum label="Late" v={counts.late} color="#F59E0B" />
            <Sum label="Leave" v={counts.leave} color="#3B82F6" />
            <Sum label="Unmarked" v={counts.none} color="#9CA3AF" />
          </View>

          <View style={styles.tools}>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color={DARK.sub} />
              <TextInput value={q} onChangeText={setQ} placeholder="Name or admission no." placeholderTextColor="rgba(255,255,255,0.35)" style={styles.searchInput} />
            </View>
            <Pressable onPress={allPresent} style={styles.allBtn}>
              <Ionicons name="checkmark-done" size={16} color="#10B981" />
              <Text style={styles.allTxt}>Rest Present</Text>
            </Pressable>
          </View>

          {classes.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.classRow}>
              <ClassChip label="All" on={classId === ""} onPress={() => setClassId("")} />
              {classes.map((c) => <ClassChip key={c.id} label={c.name} on={classId === c.id} onPress={() => setClassId(c.id)} />)}
            </ScrollView>
          )}

          {loading ? (
            <View style={styles.center}><ActivityIndicator color="#A855F7" /></View>
          ) : filtered.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="people-outline" size={56} color="rgba(255,255,255,0.25)" />
              <Text style={{ color: DARK.sub, marginTop: 8 }}>No students found.</Text>
            </View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(i) => i.id}
              contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm, paddingBottom: 130 }}
              renderItem={({ item }) => {
                const cur = marks[item.id];
                const dirty = cur !== saved[item.id];
                return (
                  <View style={[styles.row, dirty && { borderColor: "#7C3AED" }]}>
                    <Avatar name={item.student?.name} uri={item.student?.photo_url} size={40} bg="rgba(168,85,247,0.2)" fg="#C4B5FD" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name} numberOfLines={1}>{item.student?.name || "Student"}</Text>
                      <Text style={styles.meta}>{item.admission_number}</Text>
                    </View>
                    {cur === "absent" && (
                      <Pressable onPress={() => whatsappAbsent(item)} hitSlop={8} style={styles.waBtn}>
                        <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                      </Pressable>
                    )}
                    <View style={styles.btns}>
                      {STATUSES.map((s) => {
                        const on = cur === s.key;
                        return (
                          <Pressable key={s.key} onPress={() => setOne(item.id, s.key)} style={[styles.chip, { borderColor: s.color }, on && { backgroundColor: s.color }]}>
                            <Text style={[styles.chipTxt, { color: on ? "#fff" : s.color }]}>{s.label}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                );
              }}
            />
          )}

          <View style={[styles.footer, { paddingBottom: insets.bottom + SPACING.md }]}>
            <Pressable onPress={save} disabled={saving} style={[styles.saveBtn, (saving || changed.length === 0) && { opacity: 0.5 }]}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>{changed.length === 0 ? "Save Attendance" : `Save Attendance (${changed.length})`}</Text>}
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <View style={styles.dateRow}>
            <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={10} style={styles.navBtn}><Ionicons name="chevron-back" size={20} color="#fff" /></Pressable>
            <Text style={[styles.dateTxt, { flex: 1, textAlign: "center" }]}>{monthLabel(month)}</Text>
            <Pressable onPress={() => month < todayStr().slice(0, 7) && setMonth(addMonths(month, 1))} hitSlop={10} style={[styles.navBtn, month >= todayStr().slice(0, 7) && { opacity: 0.3 }]}><Ionicons name="chevron-forward" size={20} color="#fff" /></Pressable>
          </View>

          {repLoading ? (
            <View style={styles.center}><ActivityIndicator color="#A855F7" /></View>
          ) : !report || (report.items || []).length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="stats-chart-outline" size={56} color="rgba(255,255,255,0.25)" />
              <Text style={{ color: DARK.sub, marginTop: 8 }}>No data for this month.</Text>
            </View>
          ) : (
            <FlatList
              data={report.items}
              keyExtractor={(i: any) => i.connection_id}
              ListHeaderComponent={
                <View style={{ gap: SPACING.sm, marginBottom: SPACING.sm }}>
                  <View style={styles.summary}>
                    <Sum label="Class Avg" v={`${avgPct}%`} color="#A855F7" />
                    <Sum label="Days marked" v={report.days_marked} color="#3B82F6" />
                    <Sum label="Below 75%" v={(report.items || []).filter((i: any) => i.total > 0 && i.pct < 75).length} color="#EF4444" />
                  </View>
                  <Pressable onPress={shareReport} style={styles.shareBtn}>
                    <Ionicons name="share-social" size={16} color="#A855F7" />
                    <Text style={styles.shareTxt}>Share Report</Text>
                  </Pressable>
                </View>
              }
              contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xxl }}
              renderItem={({ item }: any) => {
                const low = item.total > 0 && item.pct < 75;
                const barColor = item.total === 0 ? "#6B7280" : low ? "#EF4444" : item.pct < 90 ? "#F59E0B" : "#10B981";
                return (
                  <View style={styles.repRow}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>{item.name || "Student"}</Text>
                        <Text style={styles.meta}>{item.admission_number}</Text>
                      </View>
                      <Text style={[styles.pct, { color: barColor }]}>{item.total === 0 ? "—" : `${item.pct}%`}</Text>
                    </View>
                    <View style={styles.barBg}><View style={[styles.barFill, { width: `${Math.min(item.pct, 100)}%`, backgroundColor: barColor }]} /></View>
                    <Text style={styles.meta}>P {item.present} • A {item.absent} • Late {item.late} • Leave {item.leave}</Text>
                  </View>
                );
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

function ClassChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.cChip, on && styles.cChipOn]}>
      <Text style={[styles.cChipTxt, on && { color: "#fff" }]}>{label}</Text>
    </Pressable>
  );
}

function Sum({ label, v, color }: { label: string; v: number | string; color: string }) {
  return (
    <View style={styles.sumBox}>
      <Text style={[styles.sumV, { color }]}>{v}</Text>
      <Text style={styles.sumL}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  tabs: { flexDirection: "row", marginHorizontal: SPACING.md, backgroundColor: DARK.input, borderRadius: 12, padding: 3 },
  tabBtn: { flex: 1, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: "#7C3AED" },
  tabTxt: { color: DARK.sub, fontWeight: "700", fontSize: 13 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },
  navBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: DARK.input, alignItems: "center", justifyContent: "center" },
  dateTxt: { color: "#fff", fontSize: 15, fontWeight: "800" },
  summary: { flexDirection: "row", gap: SPACING.sm, paddingHorizontal: SPACING.md },
  sumBox: { flex: 1, alignItems: "center", paddingVertical: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border },
  sumV: { fontSize: 17, fontWeight: "800" },
  sumL: { color: DARK.sub, fontSize: 10, marginTop: 2 },
  tools: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingHorizontal: SPACING.md, marginTop: SPACING.md },
  searchWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: DARK.input, borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14 },
  allBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, height: 40, borderRadius: 12, backgroundColor: "rgba(16,185,129,0.15)" },
  allTxt: { color: "#10B981", fontWeight: "700", fontSize: 12 },
  classRow: { gap: 8, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
  cChip: { paddingHorizontal: 14, height: 32, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  cChipOn: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  cChipTxt: { color: DARK.sub, fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.sm, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border },
  name: { color: DARK.text, fontWeight: "700", fontSize: 14 },
  meta: { color: DARK.sub, fontSize: 11, marginTop: 2 },
  waBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(37,211,102,0.12)", alignItems: "center", justifyContent: "center" },
  btns: { flexDirection: "row", gap: 4 },
  chip: { minWidth: 34, paddingHorizontal: 6, height: 30, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  chipTxt: { fontSize: 11, fontWeight: "800" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: SPACING.md, backgroundColor: DARK.bg, borderTopWidth: 1, borderTopColor: DARK.border },
  saveBtn: { height: 50, borderRadius: RADIUS.md, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  saveTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
  repRow: { padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border, gap: 8 },
  pct: { fontSize: 20, fontWeight: "800" },
  barBg: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.1)", overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: 12, backgroundColor: "rgba(168,85,247,0.15)", marginHorizontal: SPACING.md },
  shareTxt: { color: "#A855F7", fontWeight: "700", fontSize: 13 },
});
