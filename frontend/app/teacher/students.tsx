import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, TextInput, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";
import { StudentQuickSheet } from "@/src/components/StudentQuickSheet";
import { ReportCardSheet } from "@/src/components/ReportCardSheet";
import { callPhone, openWhatsApp } from "@/src/lib/contact";

type Item = {
  id: string; admission_number: string; monthly_fee: number; total_billed: number; paid_all: number; due: number; advance: number; active: boolean; managed?: boolean;
  class_id?: string | null; batch_id?: string | null; student: { name?: string; class?: string; phone?: string; photo_url?: string };
};
type Sort = "name" | "due" | "new";
const PAGE = 200;

export default function StudentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [sub, setSub] = useState<{ plan: string; active_students: number; free_limit: number } | null>(null);
  const [sum, setSum] = useState<{ students: number; with_due: number; total_due: number } | null>(null);
  const [classes, setClasses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "due" | "paid" | "inactive">("all");
  const [classId, setClassId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [quick, setQuick] = useState<Item | null>(null);
  const [report, setReport] = useState<string | null>(null);

  const query = useCallback((skip: number) => {
    const p = [`q=${encodeURIComponent(q)}`, `filter=${filter}`, `limit=${PAGE}`, `skip=${skip}`];
    if (classId) p.push(`class_id=${classId}`);
    if (batchId) p.push(`batch_id=${batchId}`);
    return `/teacher/students?${p.join("&")}`;
  }, [q, filter, classId, batchId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, s, sm, c, b]: any = await Promise.all([
        api(query(0)), api("/teacher/subscription"), api("/teacher/students-summary").catch(() => null),
        api("/teacher/classes").catch(() => []), api("/teacher/batches").catch(() => []),
      ]);
      setItems(res.items); setTotal(res.total); setSub(s); setSum(sm); setClasses(c || []); setBatches(b || []);
    } catch {}
    setLoading(false);
  }, [query]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadMore = async () => {
    if (more || items.length >= total) return;
    setMore(true);
    try { const res: any = await api(query(items.length)); setItems((p) => [...p, ...res.items]); } catch {}
    setMore(false);
  };

  const shown = useMemo(() => {
    const a = [...items];
    if (sort === "name") a.sort((x, y) => (x.student?.name || "").localeCompare(y.student?.name || ""));
    else if (sort === "due") a.sort((x, y) => y.due - x.due);
    return a;
  }, [items, sort]);

  const remind = (it: Item) => openWhatsApp(it.student?.phone, `Hello, fees of ${inr(it.due)} are pending for ${it.student?.name || "your child"}. Please pay at the earliest. Thank you.`);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={styles.title}>My Students</Text>
          <Pressable testID="add-student-btn" onPress={() => router.push("/teacher/add-student" as any)} style={styles.addBtn}>
            <Ionicons name="person-add" size={16} color="#fff" /><Text style={styles.addTxt}>Add</Text>
          </Pressable>
        </View>
        {sum ? (
          <View style={styles.sumRow}>
            <Sum v={String(sum.students)} l="Students" /><Sum v={String(sum.with_due)} l="With due" c="#FCA5A5" /><Sum v={inr(sum.total_due)} l="Total due" c="#FCA5A5" />
          </View>
        ) : null}
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={COLORS.muted} />
          <TextInput testID="students-search" placeholder="Search by name, admission, phone" value={q} onChangeText={setQ} onSubmitEditing={load} style={styles.searchInput} placeholderTextColor={COLORS.muted} returnKeyType="search" />
          {q ? <Pressable onPress={() => setQ("")} hitSlop={8}><Ionicons name="close-circle" size={18} color={COLORS.muted} /></Pressable> : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm, paddingTop: SPACING.sm }}>
          {(["all", "due", "paid", "inactive"] as const).map((f) => (
            <Pressable key={f} testID={`filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]}>
              <Text style={[styles.chipTxt, filter === f && styles.chipTxtOn]}>{f === "all" ? "All" : f === "due" ? "With Due" : f === "paid" ? "Fully Paid" : "Inactive"}</Text>
            </Pressable>
          ))}
          <View style={styles.sep} />
          {classes.map((c) => (
            <Pressable key={c.id} onPress={() => setClassId(classId === c.id ? "" : c.id)} style={[styles.chip, classId === c.id && styles.chipOn]}>
              <Text style={[styles.chipTxt, classId === c.id && styles.chipTxtOn]}>{c.name}</Text>
            </Pressable>
          ))}
          {batches.map((b) => (
            <Pressable key={b.id} onPress={() => setBatchId(batchId === b.id ? "" : b.id)} style={[styles.chip, batchId === b.id && styles.chipOn]}>
              <Text style={[styles.chipTxt, batchId === b.id && styles.chipTxtOn]}>{b.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.sortRow}>
          <Text style={styles.sortLbl}>{total} student{total === 1 ? "" : "s"}  •  Sort:</Text>
          {([["name", "Name"], ["due", "Highest due"], ["new", "Newest"]] as [Sort, string][]).map(([k, l]) => (
            <Pressable key={k} onPress={() => setSort(k)} style={[styles.sortChip, sort === k && styles.sortOn]}><Text style={[styles.sortTxt, sort === k && { color: "#fff" }]}>{l}</Text></Pressable>
          ))}
        </View>
      </View>

      {sub && sub.plan === "free" && sub.active_students >= (sub.free_limit - 5) && (
        <Pressable testID="free-banner" onPress={() => router.push("/teacher/subscription")} style={styles.banner}>
          <Ionicons name="rocket" size={18} color={COLORS.brand} />
          <Text style={styles.bannerTxt}>{sub.active_students}/{sub.free_limit} Free students used — Upgrade to Pro for unlimited</Text>
          <Ionicons name="chevron-forward" size={18} color={COLORS.brand} />
        </Pressable>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
      ) : shown.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={56} color={COLORS.borderStrong} />
          <Text style={styles.empty}>{q || classId || batchId || filter !== "all" ? "No student matches" : "No students yet"}</Text>
          <Text style={styles.emptySub}>{q || classId || batchId || filter !== "all" ? "Try another search or clear the filters." : "Accept student requests, or use \"Add\" above to add a student who does not have the app."}</Text>
        </View>
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(i) => i.id}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={more ? <ActivityIndicator color={COLORS.brand} style={{ margin: 12 }} /> : null}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.md }}
          renderItem={({ item }) => (
            <Pressable testID={`student-row-${item.admission_number}`} style={[styles.row, item.active === false && { opacity: 0.55 }]} onPress={() => setQuick(item)}>
              <Avatar name={item.student?.name} uri={item.student?.photo_url} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.rowName} numberOfLines={1}>{item.student?.name || "Student"}</Text>
                  {item.managed ? <Text style={styles.noApp}>No app</Text> : null}
                </View>
                <Text style={styles.rowMeta}>{item.admission_number} • {classes.find((c) => c.id === item.class_id)?.name || item.student?.class || "—"}</Text>
                <Text style={styles.rowMeta}>Monthly {inr(item.monthly_fee)} • Paid {inr(item.paid_all)}</Text>
              </View>
              <View style={{ alignItems: "flex-end", gap: 6 }}>
                <Text style={item.due > 0 ? styles.due : styles.paid}>{item.due > 0 ? inr(item.due) : "Paid"}</Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => callPhone(item.student?.phone)} hitSlop={6} style={styles.mini}><Ionicons name="call" size={15} color="#16A34A" /></Pressable>
                  {item.due > 0 ? <Pressable onPress={() => remind(item)} hitSlop={6} style={[styles.mini, { backgroundColor: "#DCFCE7" }]} testID={`remind-${item.admission_number}`}><Ionicons name="logo-whatsapp" size={15} color="#16A34A" /></Pressable> : null}
                </View>
              </View>
            </Pressable>
          )}
        />
      )}

      <StudentQuickSheet visible={!!quick} item={quick} onClose={() => setQuick(null)} bottomInset={insets.bottom}
        onOpenProfile={(id) => router.push(`/teacher/student/${id}` as any)} onOpenReport={(id) => setReport(id)} />
      <ReportCardSheet visible={!!report} connectionId={report} onClose={() => setReport(null)} bottomInset={insets.bottom} />
    </View>
  );
}

function Sum({ v, l, c }: { v: string; l: string; c?: string }) {
  return <View style={styles.sum}><Text style={[styles.sumV, c ? { color: c } : null]} numberOfLines={1} adjustsFontSizeToFit>{v}</Text><Text style={styles.sumL}>{l}</Text></View>;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md, backgroundColor: "#071E4A" },
  title: { fontSize: 24, fontWeight: "800", color: "#FFFFFF", marginBottom: SPACING.sm },
  sumRow: { flexDirection: "row", gap: 8, marginBottom: SPACING.md },
  sum: { flex: 1, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, paddingVertical: 8, alignItems: "center" },
  sumV: { color: "#fff", fontSize: 17, fontWeight: "900" },
  sumL: { color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 1 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 44 },
  searchInput: { flex: 1, color: COLORS.onSurface, fontSize: 14 },
  chip: { flexShrink: 0, height: 34, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border },
  chipOn: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipTxt: { color: COLORS.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipTxtOn: { color: "#fff" },
  sep: { width: 1, backgroundColor: "rgba(255,255,255,0.25)", marginHorizontal: 2 },
  sortRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: SPACING.sm, flexWrap: "wrap" },
  sortLbl: { color: "rgba(255,255,255,0.65)", fontSize: 12 },
  sortChip: { paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  sortOn: { backgroundColor: COLORS.brand },
  sortTxt: { color: "rgba(255,255,255,0.75)", fontSize: 11.5, fontWeight: "700" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  empty: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  emptySub: { color: COLORS.muted, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.md, backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  rowName: { fontSize: 15, fontWeight: "700", color: COLORS.onSurface, flexShrink: 1 },
  rowMeta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  due: { color: COLORS.error, fontWeight: "800" },
  paid: { color: COLORS.success, fontWeight: "800" },
  mini: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, height: 36, borderRadius: RADIUS.pill, backgroundColor: COLORS.brand },
  addTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  noApp: { fontSize: 10, fontWeight: "800", color: "#B45309", backgroundColor: "#FEF3C7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
  banner: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, margin: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.brandSoft, borderRadius: RADIUS.md, borderWidth: 1, borderColor: "#DDD6FE" },
  bannerTxt: { flex: 1, color: COLORS.brand, fontSize: 12, fontWeight: "700" },
});
