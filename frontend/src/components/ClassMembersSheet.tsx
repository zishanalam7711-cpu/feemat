import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";

type Kind = "classes" | "batches";

// Teacher: who is inside a class / batch, take students out, and add students to it (one tap for many).
export function ClassMembersSheet({ visible, onClose, kind, item, bottomInset, onChanged }: {
  visible: boolean; onClose: () => void; kind: Kind; item: any; bottomInset: number; onChanged: () => void;
}) {
  const field = kind === "classes" ? "class_id" : "batch_id";
  const [tab, setTab] = useState<"in" | "add">("in");
  const [members, setMembers] = useState<any[]>([]);
  const [all, setAll] = useState<any[]>([]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!item) return;
    setLoading(true);
    try {
      const [m, s]: any = await Promise.all([api(`/teacher/${kind}/${item.id}/students`), api("/teacher/students?filter=all&limit=200")]);
      setMembers(m || []); setAll(s.items || []);
    } catch (e: any) { Alert.alert("Could not load", e?.message || ""); }
    setLoading(false);
  }, [item?.id, kind]);
  useEffect(() => { if (visible) { setTab("in"); setSel({}); setQ(""); load(); } }, [visible, load]);

  const candidates = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return all.filter((c) => c[field] !== item?.id && (!qq || (c.student?.name || "").toLowerCase().includes(qq) || String(c.admission_number || "").toLowerCase().includes(qq)));
  }, [all, q, item?.id, field]);
  const ids = Object.keys(sel).filter((k) => sel[k]);

  const run = async (remove: boolean) => {
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      await api(`/teacher/${kind}/${item.id}/assign`, { method: "POST", body: { connection_ids: ids, remove } });
      setSel({}); await load(); onChanged();
    } catch (e: any) { Alert.alert("Could not save", e?.message || "Please try again."); }
    setBusy(false);
  };

  const rows = tab === "in" ? members.map((m) => ({ id: m.connection_id, name: m.name, meta: m.admission_number })) : candidates.map((c) => ({ id: c.id, name: c.student?.name || "Student", meta: `${c.admission_number}${c[field] ? "  •  already in another " + kind.slice(0, -1) : ""}` }));

  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}><View style={{ flex: 1 }}><Text style={s.title}>{item?.name}</Text><Text style={s.sub}>{members.length} student{members.length === 1 ? "" : "s"}</Text></View><Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable></View>
          <View style={s.seg}>
            {([["in", `In this ${kind.slice(0, -1)} (${members.length})`], ["add", "Add students"]] as ["in" | "add", string][]).map(([k, l]) => (
              <Pressable key={k} onPress={() => { setTab(k); setSel({}); }} style={[s.segBtn, tab === k && s.segOn]}><Text style={[s.segTxt, tab === k && { color: "#fff" }]}>{l}</Text></Pressable>))}
          </View>
          {tab === "add" ? <View style={s.search}><Ionicons name="search" size={16} color="#94A3B8" /><TextInput value={q} onChangeText={setQ} placeholder="Search students" placeholderTextColor="#94A3B8" style={s.searchInput} /></View> : null}
          {loading ? <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} /> : rows.length === 0 ? (
            <Text style={s.empty}>{tab === "in" ? "No students here yet. Use \"Add students\"." : "No other students to add."}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="handled">
              {rows.map((r) => (
                <Pressable key={r.id} onPress={() => setSel((p) => ({ ...p, [r.id]: !p[r.id] }))} style={s.row}>
                  <Ionicons name={sel[r.id] ? "checkbox" : "square-outline"} size={24} color={sel[r.id] ? "#1F6BFF" : "#94A3B8"} />
                  <View style={{ flex: 1 }}><Text style={s.name}>{r.name}</Text><Text style={s.meta}>{r.meta}</Text></View>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {ids.length ? (
            <Pressable onPress={() => run(tab === "in")} disabled={busy} style={[s.go, tab === "in" && { backgroundColor: "#DC2626" }, busy && { opacity: 0.6 }]} testID="members-apply">
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.goTxt}>{tab === "in" ? `Remove ${ids.length} from this ${kind.slice(0, -1)}` : `Add ${ids.length} student${ids.length === 1 ? "" : "s"}`}</Text>}
            </Pressable>
          ) : null}
        </View>
      </View>
    </InlineOverlay>
  );
}
const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  head: { flexDirection: "row", alignItems: "center" },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  seg: { flexDirection: "row", backgroundColor: "#EEF4FF", borderRadius: 14, padding: 3, marginVertical: 12 },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 11 },
  segOn: { backgroundColor: "#1F6BFF" },
  segTxt: { fontWeight: "800", color: "#1F6BFF", fontSize: 12.5 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#F1F5F9", borderRadius: 12, paddingHorizontal: 12, height: 42, marginBottom: 6 },
  searchInput: { flex: 1, color: "#0F172A", fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#EEF2F7" },
  name: { fontSize: 15, fontWeight: "700", color: "#0F172A" },
  meta: { fontSize: 12, color: "#64748B", marginTop: 2 },
  empty: { color: "#64748B", textAlign: "center", padding: 28 },
  go: { alignItems: "center", justifyContent: "center", height: 50, borderRadius: 14, backgroundColor: "#1F6BFF", marginTop: 12 },
  goTxt: { color: "#fff", fontWeight: "800", fontSize: 14.5 },
});
