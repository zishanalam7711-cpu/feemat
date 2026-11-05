import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { localToday } from "@/src/lib/hwFiles";

const inr = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const addMonths = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 + n, 1)).toISOString().slice(0, 7); };
const label = (m: string) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }); };

function Sheet({ visible, onClose, title, bottomInset, children }: { visible: boolean; onClose: () => void; title: string; bottomInset: number; children: React.ReactNode }) {
  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 14 }]}>
          <View style={s.head}><Text style={s.title}>{title}</Text><Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable></View>
          {children}
        </View>
      </View>
    </InlineOverlay>
  );
}

// Teacher: every payment of a month, per day and per method, ready to share.
export function CollectionStatementSheet({ visible, onClose, bottomInset }: { visible: boolean; onClose: () => void; bottomInset: number }) {
  const thisMonth = localToday().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { setD(null); setErr(""); try { setD(await api(`/teacher/reports/collection-statement?month=${month}`)); } catch (e: any) { setErr(e?.message || "Could not load."); } }, [month]);
  useEffect(() => { if (visible) load(); }, [visible, load]);
  const maxDay = d ? Math.max(1, ...d.days.map((x: any) => x.amount)) : 1;
  return (
    <Sheet visible={visible} onClose={onClose} title="Collection statement" bottomInset={bottomInset}>
      <View style={s.monthRow}>
        <Pressable onPress={() => setMonth(addMonths(month, -1))} hitSlop={10} style={s.nav}><Ionicons name="chevron-back" size={18} color="#1F6BFF" /></Pressable>
        <Text style={s.monthTxt}>{label(month)}</Text>
        <Pressable onPress={() => month < thisMonth && setMonth(addMonths(month, 1))} hitSlop={10} style={[s.nav, month >= thisMonth && { opacity: 0.3 }]}><Ionicons name="chevron-forward" size={18} color="#1F6BFF" /></Pressable>
      </View>
      {err ? <Text style={s.err}>{err}</Text> : !d ? <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} /> : (
        <ScrollView style={{ maxHeight: 540 }} showsVerticalScrollIndicator={false}>
          <View style={s.hero}><Text style={s.heroAmt}>{inr(d.total)}</Text><Text style={s.heroSub}>{d.count} payment{d.count === 1 ? "" : "s"}{d.best_day ? `  •  best day ${d.best_day.date.slice(8)}/${d.best_day.date.slice(5, 7)} (${inr(d.best_day.amount)})` : ""}</Text></View>
          {Object.keys(d.methods).length ? <View style={s.methods}>{Object.entries(d.methods).map(([m, a]: any) => <View key={m} style={s.method}><Text style={s.methodAmt}>{inr(a)}</Text><Text style={s.methodLbl}>{m}</Text></View>)}</View> : null}
          {d.days.length ? (
            <View style={s.card}><Text style={s.h}>Day by day</Text>
              {d.days.map((x: any) => (
                <View key={x.date} style={{ marginTop: 8 }}>
                  <View style={s.between}><Text style={s.dayTxt}>{x.date.slice(8)}/{x.date.slice(5, 7)}  •  {x.count} payment{x.count === 1 ? "" : "s"}</Text><Text style={s.dayAmt}>{inr(x.amount)}</Text></View>
                  <View style={s.bar}><View style={[s.fill, { width: `${(x.amount / maxDay) * 100}%` }]} /></View>
                </View>))}
            </View>
          ) : <Text style={s.empty}>No payments in this month.</Text>}
          {d.payments.length ? (
            <View style={s.card}><Text style={s.h}>All payments</Text>
              {d.payments.slice(0, 60).map((p: any) => (
                <View key={String(p.receipt_number) + p.time + p.name} style={s.pay}>
                  <View style={{ flex: 1 }}><Text style={s.payName}>{p.name}</Text><Text style={s.paySub}>{p.date.slice(8)}/{p.date.slice(5, 7)} {p.time}  •  {p.method}{p.receipt_number ? `  •  #${p.receipt_number}` : ""}</Text></View>
                  <Text style={s.payAmt}>{inr(p.amount)}</Text>
                </View>))}
            </View>
          ) : null}
          {d.count ? <Pressable onPress={() => Share.share({ message: d.share_text }).catch(() => {})} style={s.share}><Ionicons name="share-social" size={17} color="#1F6BFF" /><Text style={s.shareTxt}>Share statement</Text></Pressable> : null}
        </ScrollView>
      )}
    </Sheet>
  );
}

// Teacher: every exam with average, pass %, toppers; subjects; students to watch.
export function ExamPerformanceSheet({ visible, onClose, bottomInset }: { visible: boolean; onClose: () => void; bottomInset: number }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => { if (!visible) return; setD(null); setErr(""); api("/teacher/reports/exam-performance").then(setD).catch((e: any) => setErr(e?.message || "Could not load.")); }, [visible]);
  const col = (p: number | null) => (p == null ? "#64748B" : p >= 75 ? "#16A34A" : p >= 50 ? "#D97706" : "#DC2626");
  return (
    <Sheet visible={visible} onClose={onClose} title="Exam performance" bottomInset={bottomInset}>
      {err ? <Text style={s.err}>{err}</Text> : !d ? <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} /> : d.exams.length === 0 ? <Text style={s.empty}>No marks have been entered yet.</Text> : (
        <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
          {d.subjects.length ? <View style={s.card}><Text style={s.h}>Subjects (average)</Text>
            {d.subjects.map((x: any) => <View key={x.subject} style={{ marginTop: 8 }}><View style={s.between}><Text style={s.dayTxt}>{x.subject}</Text><Text style={[s.dayAmt, { color: col(x.average_pct) }]}>{x.average_pct}%</Text></View>
              <View style={s.bar}><View style={[s.fill, { width: `${Math.min(100, x.average_pct)}%`, backgroundColor: col(x.average_pct) }]} /></View></View>)}
          </View> : null}
          {d.exams.map((e: any) => (
            <View key={e.exam_id} style={s.card}>
              <View style={s.between}><View style={{ flex: 1 }}><Text style={s.payName}>{e.title}</Text><Text style={s.paySub}>{[e.subject, e.date].filter(Boolean).join("  •  ")}  •  {e.entered} students{e.absent ? `, ${e.absent} absent` : ""}</Text></View>
                <Text style={[s.heroAmt, { fontSize: 24, color: col(e.average_pct) }]}>{e.average_pct != null ? e.average_pct + "%" : "-"}</Text></View>
              <Text style={s.paySub}>Pass {e.pass_pct != null ? e.pass_pct + "%" : "-"}{e.highest ? `  •  Highest ${e.highest.name} ${e.highest.pct}%` : ""}{e.lowest && e.entered > 1 ? `  •  Lowest ${e.lowest.pct}%` : ""}</Text>
              {e.toppers?.length ? <Text style={[s.paySub, { marginTop: 4 }]}>🏆 {e.toppers.map((t: any) => `${t.name} (${t.pct}%)`).join(", ")}</Text> : null}
            </View>))}
          {d.watch.length ? <View style={[s.card, { borderColor: "#FCA5A5", backgroundColor: "#FEF2F2" }]}><Text style={[s.h, { color: "#B91C1C" }]}>Students to watch (average below 40%)</Text>
            {d.watch.map((w: any) => <View key={w.name} style={[s.between, { marginTop: 6 }]}><Text style={s.dayTxt}>{w.name}</Text><Text style={[s.dayAmt, { color: "#DC2626" }]}>{w.average_pct}%</Text></View>)}
          </View> : null}
        </ScrollView>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#F1F5F9", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, maxHeight: "92%" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  monthRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  nav: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#E0ECFF", alignItems: "center", justifyContent: "center" },
  monthTxt: { flex: 1, textAlign: "center", fontWeight: "800", color: "#0F172A", fontSize: 15 },
  hero: { backgroundColor: "#1F4FD8", borderRadius: 18, padding: 16 },
  heroAmt: { color: "#fff", fontSize: 32, fontWeight: "900" },
  heroSub: { color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 3 },
  methods: { flexDirection: "row", gap: 8, marginTop: 10 },
  method: { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 10, alignItems: "center", borderWidth: 1, borderColor: "#E2E8F0" },
  methodAmt: { fontWeight: "900", color: "#0F172A", fontSize: 15 },
  methodLbl: { color: "#64748B", fontSize: 11, marginTop: 2, fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 14, padding: 12, marginTop: 10, borderWidth: 1, borderColor: "#E2E8F0" },
  h: { fontWeight: "800", color: "#0F172A", fontSize: 13 },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  dayTxt: { color: "#334155", fontSize: 13, fontWeight: "600" },
  dayAmt: { color: "#0F172A", fontWeight: "800", fontSize: 13 },
  bar: { height: 7, borderRadius: 4, backgroundColor: "#E2E8F0", marginTop: 4 },
  fill: { height: 7, borderRadius: 4, backgroundColor: "#1F6BFF" },
  pay: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  payName: { fontSize: 14.5, fontWeight: "800", color: "#0F172A" },
  paySub: { color: "#64748B", fontSize: 12, marginTop: 2 },
  payAmt: { color: "#16A34A", fontWeight: "900", fontSize: 14 },
  share: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: "#BFD7FF", backgroundColor: "#fff", marginTop: 12 },
  shareTxt: { color: "#1F6BFF", fontWeight: "800" },
  err: { color: "#B91C1C", padding: 18, textAlign: "center" },
  empty: { color: "#64748B", textAlign: "center", padding: 28 },
});
