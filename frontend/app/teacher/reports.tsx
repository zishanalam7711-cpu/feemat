import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert, Linking, Share, RefreshControl,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { ProUpgradeModal } from "@/src/components/ProUpgradeModal";

const DARK = {
  bg: "#120A28",
  card: "#1E1440",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  input: "rgba(255,255,255,0.07)",
};

type Tab = "overview" | "fees" | "attendance" | "exams";
const TABS: { k: Tab; l: string }[] = [
  { k: "overview", l: "Overview" },
  { k: "fees", l: "Fees" },
  { k: "attendance", l: "Attendance" },
  { k: "exams", l: "Exams" },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mLabel = (m: string) => (m ? MONTHS[Number(m.slice(5, 7)) - 1] || m : "");
const fullMonth = (m: string) => (m ? `${mLabel(m)} ${m.slice(0, 4)}` : "");

function waNumber(phone?: string) {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d;
}
function pctColor(p: number) {
  return p >= 90 ? "#10B981" : p >= 75 ? "#F59E0B" : "#EF4444";
}

export default function Reports() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pro, setPro] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api("/teacher/reports/advanced"));
    } catch (e: any) {
      if (String(e?.message || "").includes("Upgrade to Pro")) setPro(true);
    }
  }, []);
  useFocusEffect(useCallback(() => { load().finally(() => setLoading(false)); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const ov = data?.overview;

  // ---------- smart insights ----------
  const insights = useMemo(() => {
    if (!data) return [] as { icon: any; color: string; text: string }[];
    const out: { icon: any; color: string; text: string }[] = [];
    const o = data.overview;
    if (o.collected_prev > 0) {
      const ch = Math.round(((o.collected_month - o.collected_prev) / o.collected_prev) * 100);
      if (ch >= 0) out.push({ icon: "trending-up", color: "#10B981", text: `Is mahine ki collection pichle mahine se ${ch}% zyada hai.` });
      else out.push({ icon: "trending-down", color: "#EF4444", text: `Is mahine ki collection pichle mahine se ${Math.abs(ch)}% kam hai.` });
    }
    const long = (data.defaulters || []).filter((d: any) => d.pending_months >= 3).length;
    if (long > 0) out.push({ icon: "alert-circle", color: "#EF4444", text: `${long} students ki 3 ya zyada mahine ki fees baaki hai.` });
    const cp = (data.class_pending || []).filter((c: any) => c.due > 0);
    if (cp.length > 1) out.push({ icon: "school", color: "#F59E0B", text: `${cp[0].class} mein sabse zyada fees baaki hai (${inr(cp[0].due)}).` });
    const bc = data.attendance?.by_class || [];
    if (bc.length > 1) out.push({ icon: "calendar", color: "#F59E0B", text: `${bc[0].class} ki attendance sabse kam hai (${bc[0].avg}%).` });
    const sj = data.exams?.subjects || [];
    if (sj.length > 1) out.push({ icon: "book", color: "#3B82F6", text: `${sj[0].subject} sabse kamzor subject hai (average ${sj[0].avg}%).` });
    if ((data.attention || []).length > 0) out.push({ icon: "eye", color: "#A855F7", text: `${data.attention.length} students par extra dhyan dene ki zarurat hai.` });
    if (out.length === 0) out.push({ icon: "sparkles", color: "#A855F7", text: "Abhi sab theek lag raha hai. Jaise-jaise data badhega, yahan sujhav aayenge." });
    return out;
  }, [data]);

  const shareSummary = async () => {
    if (!data) return;
    const o = data.overview;
    const msg =
      `📊 FeeMat Summary — ${fullMonth(data.month)}\n\n` +
      `👥 Students: ${o.students}\n` +
      `💰 Is mahine collection: ${inr(o.collected_month)}\n` +
      `⏳ Total baaki: ${inr(o.total_due)}\n` +
      `📈 Collection rate: ${o.collection_rate}%\n` +
      `🗓️ Attendance average: ${o.attendance_avg}%` +
      (o.last_exam_avg != null ? `\n📝 Last exam average: ${o.last_exam_avg}%` : "");
    await Share.share({ message: msg });
  };

  const whatsappDue = (d: any) => {
    const num = waNumber(d.phone);
    if (!num) { Alert.alert("Phone number nahi hai", "Is student ka phone number profile mein nahi hai."); return; }
    const msg = `Namaste, ${d.name} ki ${d.pending_months} mahine ki fees baaki hai (${inr(d.due)}). Kripya jaldi jama karein. Dhanyavaad.`;
    Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`).catch(() => {});
  };

  const shareDefaulters = async () => {
    const list = data?.defaulters || [];
    if (!list.length) return;
    const lines = list.map((d: any, i: number) => `${i + 1}. ${d.name} (${d.class_name}) — ${inr(d.due)} • ${d.pending_months} mahine`);
    await Share.share({ message: `Baaki fees ki list — ${fullMonth(data.month)}\n\n${lines.join("\n")}` });
  };

  const runReminders = async () => {
    setSending(true);
    try {
      await api("/teacher/reminders/run", { method: "POST" });
      Alert.alert("Reminder bhej diye", "Fees baaki wale students ko app mein reminder chala gaya.");
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Reminder nahi gaya.");
    }
    setSending(false);
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
      <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
      <Text style={styles.title}>Reports & Analytics</Text>
      {data ? (
        <Pressable onPress={shareSummary} hitSlop={10}><Ionicons name="share-social" size={22} color="#A855F7" /></Pressable>
      ) : <View style={{ width: 22 }} />}
    </View>
  );

  if (loading) return <View style={[styles.center, { backgroundColor: DARK.bg }]}><ActivityIndicator color="#A855F7" /></View>;
  if (pro) return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      {header}
      <ProUpgradeModal visible={pro} onClose={() => { setPro(false); router.back(); }} feature="Reports & Analytics" />
    </View>
  );
  if (!data) return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      {header}
      <View style={styles.center}>
        <Ionicons name="cloud-offline-outline" size={56} color="rgba(255,255,255,0.25)" />
        <Text style={{ color: DARK.sub, marginTop: 8, textAlign: "center", paddingHorizontal: 30 }}>Report load nahi hui. Internet check karo, ya thodi der baad dobara try karo.</Text>
        <Pressable onPress={() => { setLoading(true); load().finally(() => setLoading(false)); }} style={styles.retry}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>Dobara try karo</Text>
        </Pressable>
      </View>
    </View>
  );

  const maxVal = Math.max(1, ...(data.monthly_collection || []).map((x: any) => x.amount));
  const methodsArr = Object.entries(data.methods || {}) as [string, number][];
  const methodTotal = methodsArr.reduce((a, [, v]) => a + v, 0);
  const delta = ov.collected_prev > 0 ? Math.round(((ov.collected_month - ov.collected_prev) / ov.collected_prev) * 100) : null;

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      {header}
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.k} onPress={() => setTab(t.k)} style={[styles.tabBtn, tab === t.k && styles.tabOn]}>
            <Text style={[styles.tabTxt, tab === t.k && { color: "#fff" }]}>{t.l}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#A855F7" />}
      >
        {/* ================= OVERVIEW ================= */}
        {tab === "overview" && (
          <>
            <View style={styles.grid}>
              <Stat icon="people" color="#A855F7" label="Students" value={String(ov.students)} />
              <Stat icon="cash" color="#10B981" label="Is mahine collection" value={inr(ov.collected_month)}
                sub={delta === null ? undefined : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% pichle mahine se`} subColor={delta !== null && delta >= 0 ? "#10B981" : "#EF4444"} />
              <Stat icon="hourglass" color="#EF4444" label="Total baaki" value={inr(ov.total_due)} />
              <Stat icon="speedometer" color="#3B82F6" label="Collection rate" value={`${ov.collection_rate}%`} />
            </View>

            <View style={styles.todayBox}>
              <Ionicons name="today" size={18} color="#F59E0B" />
              <Text style={styles.todayTxt}>Aaj jama hua: <Text style={{ fontWeight: "800", color: "#fff" }}>{inr(ov.collected_today)}</Text></Text>
            </View>

            <Card title="Smart Insights">
              {insights.map((i, idx) => (
                <View key={idx} style={styles.insightRow}>
                  <View style={[styles.insightIcon, { backgroundColor: i.color + "26" }]}><Ionicons name={i.icon} size={16} color={i.color} /></View>
                  <Text style={styles.insightTxt}>{i.text}</Text>
                </View>
              ))}
            </Card>

            <Card title="Pichle 6 mahine ki collection">
              <View style={styles.chart}>
                {data.monthly_collection.map((x: any) => (
                  <View key={x.month} style={styles.bar}>
                    <Text style={styles.barAmt}>{x.amount >= 1000 ? `${Math.round(x.amount / 100) / 10}k` : Math.round(x.amount)}</Text>
                    <View style={styles.barTrack}><View style={[styles.barFill, { height: `${(x.amount / maxVal) * 100}%` }]} /></View>
                    <Text style={styles.barLbl}>{mLabel(x.month)}</Text>
                  </View>
                ))}
              </View>
            </Card>

            <View style={styles.grid}>
              <Stat icon="calendar" color="#14B8A6" label="Attendance avg (is mahine)" value={`${ov.attendance_avg}%`} />
              <Stat icon="document-text" color="#F59E0B" label="Last exam average" value={ov.last_exam_avg == null ? "—" : `${ov.last_exam_avg}%`} />
            </View>

            <Card title={`Dhyan dene wale students (${data.attention.length})`}>
              {data.attention.length === 0 ? (
                <Text style={styles.empty}>Abhi koi nahi. Sab theek chal raha hai 🎉</Text>
              ) : (
                data.attention.map((a: any) => (
                  <Pressable key={a.connection_id} style={styles.listRow} onPress={() => router.push(`/teacher/student/${a.connection_id}` as any)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{a.name}</Text>
                      <Text style={styles.meta}>{a.class_name} • {a.admission_number}</Text>
                      <View style={styles.reasonWrap}>
                        {a.reasons.map((r: string) => (
                          <View key={r} style={styles.reasonChip}><Text style={styles.reasonTxt}>{r}</Text></View>
                        ))}
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={DARK.sub} />
                  </Pressable>
                ))
              )}
            </Card>
          </>
        )}

        {/* ================= FEES ================= */}
        {tab === "fees" && (
          <>
            <Card title="Payment ka tarika (is mahine)">
              {methodsArr.length === 0 ? (
                <Text style={styles.empty}>Is mahine abhi koi payment nahi aayi.</Text>
              ) : (
                methodsArr.sort((a, b) => b[1] - a[1]).map(([m, v]) => (
                  <View key={m} style={{ marginTop: 10 }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.name}>{m}</Text>
                      <Text style={styles.name}>{inr(v)} <Text style={styles.meta}>({Math.round((v / methodTotal) * 100)}%)</Text></Text>
                    </View>
                    <View style={styles.barBg}><View style={[styles.barFillH, { width: `${(v / methodTotal) * 100}%`, backgroundColor: "#7C3AED" }]} /></View>
                  </View>
                ))
              )}
            </Card>

            <Card title="Class-wise baaki fees">
              {data.class_pending.length === 0 ? <Text style={styles.empty}>Koi class nahi mili.</Text> :
                data.class_pending.map((c: any) => (
                  <View key={c.class} style={styles.listRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{c.class}</Text>
                      <Text style={styles.meta}>{c.students} students</Text>
                    </View>
                    <Text style={[styles.amt, { color: c.due > 0 ? "#F87171" : "#34D399" }]}>{c.due > 0 ? inr(c.due) : "Clear"}</Text>
                  </View>
                ))}
            </Card>

            <View style={{ flexDirection: "row", gap: SPACING.sm }}>
              <Pressable onPress={runReminders} disabled={sending} style={[styles.action, { backgroundColor: "#7C3AED" }, sending && { opacity: 0.6 }]}>
                {sending ? <ActivityIndicator color="#fff" /> : (<><Ionicons name="notifications" size={16} color="#fff" /><Text style={styles.actionTxt}>Sab ko Reminder</Text></>)}
              </Pressable>
              <Pressable onPress={shareDefaulters} style={[styles.action, { backgroundColor: "rgba(168,85,247,0.18)" }]}>
                <Ionicons name="share-social" size={16} color="#A855F7" />
                <Text style={[styles.actionTxt, { color: "#A855F7" }]}>List Share</Text>
              </Pressable>
            </View>

            <Card title={`Baaki fees wale (${data.defaulters.length})`}>
              {data.defaulters.length === 0 ? <Text style={styles.empty}>Kisi ki fees baaki nahi hai 🎉</Text> :
                data.defaulters.map((d: any) => (
                  <View key={d.connection_id} style={styles.listRow}>
                    <Pressable style={{ flex: 1 }} onPress={() => router.push(`/teacher/student/${d.connection_id}` as any)}>
                      <Text style={styles.name}>{d.name}</Text>
                      <Text style={styles.meta}>{d.class_name} • {d.pending_months} mahine se ({fullMonth(d.oldest_month)})</Text>
                    </Pressable>
                    <Text style={[styles.amt, { color: "#F87171" }]}>{inr(d.due)}</Text>
                    <Pressable onPress={() => whatsappDue(d)} hitSlop={8} style={styles.waBtn}>
                      <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
                    </Pressable>
                  </View>
                ))}
            </Card>
          </>
        )}

        {/* ================= ATTENDANCE ================= */}
        {tab === "attendance" && (
          <>
            <View style={styles.grid}>
              <Stat icon="calendar" color="#14B8A6" label={`Average (${fullMonth(data.month)})`} value={`${data.attendance.avg}%`} />
              <Stat icon="today" color="#3B82F6" label="Din lage (is mahine)" value={String(data.attendance.days_marked)} />
            </View>

            <Card title="Class-wise average">
              {data.attendance.by_class.length === 0 ? <Text style={styles.empty}>Is mahine ka attendance data nahi hai.</Text> :
                data.attendance.by_class.map((c: any) => (
                  <View key={c.class} style={{ marginTop: 10 }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.name}>{c.class}</Text>
                      <Text style={[styles.name, { color: pctColor(c.avg) }]}>{c.avg}%</Text>
                    </View>
                    <View style={styles.barBg}><View style={[styles.barFillH, { width: `${Math.min(c.avg, 100)}%`, backgroundColor: pctColor(c.avg) }]} /></View>
                  </View>
                ))}
            </Card>

            <Card title={`75% se kam attendance (${data.attendance.low.length})`}>
              {data.attendance.low.length === 0 ? <Text style={styles.empty}>Sab ki attendance 75% se upar hai 👏</Text> :
                data.attendance.low.map((r: any) => (
                  <Pressable key={r.connection_id} style={styles.listRow} onPress={() => router.push(`/teacher/student/${r.connection_id}` as any)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{r.name}</Text>
                      <Text style={styles.meta}>{r.class_name} • {r.absent} din absent</Text>
                    </View>
                    <Text style={[styles.amt, { color: pctColor(r.pct) }]}>{r.pct}%</Text>
                  </Pressable>
                ))}
            </Card>

            <Card title="Sabse regular students 🌟">
              {data.attendance.regular.length === 0 ? <Text style={styles.empty}>Abhi kam data hai.</Text> :
                data.attendance.regular.map((r: any, i: number) => (
                  <View key={r.connection_id} style={styles.listRow}>
                    <Text style={styles.rank}>{i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{r.name}</Text>
                      <Text style={styles.meta}>{r.class_name}</Text>
                    </View>
                    <Text style={[styles.amt, { color: "#10B981" }]}>{r.pct}%</Text>
                  </View>
                ))}
            </Card>
          </>
        )}

        {/* ================= EXAMS ================= */}
        {tab === "exams" && (
          <>
            <Card title="Exam-wise average (naye neeche)">
              {data.exams.trend.length === 0 ? <Text style={styles.empty}>Abhi kisi exam ke marks nahi daale gaye.</Text> :
                data.exams.trend.map((t: any, i: number) => (
                  <View key={i} style={{ marginTop: 10 }}>
                    <View style={styles.rowBetween}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name} numberOfLines={1}>{t.title}</Text>
                        <Text style={styles.meta}>{t.subject || "General"} • {t.date} • {t.n} students • Pass {t.pass_pct}%</Text>
                      </View>
                      <Text style={[styles.amt, { color: pctColor(t.avg) }]}>{t.avg}%</Text>
                    </View>
                    <View style={styles.barBg}><View style={[styles.barFillH, { width: `${Math.min(t.avg, 100)}%`, backgroundColor: pctColor(t.avg) }]} /></View>
                  </View>
                ))}
            </Card>

            <Card title="Subject-wise average (kamzor upar)">
              {data.exams.subjects.length === 0 ? <Text style={styles.empty}>Abhi data nahi hai.</Text> :
                data.exams.subjects.map((s: any, i: number) => (
                  <View key={s.subject} style={{ marginTop: 10 }}>
                    <View style={styles.rowBetween}>
                      <Text style={styles.name}>{s.subject}{i === 0 && data.exams.subjects.length > 1 ? "  ⚠️" : ""}</Text>
                      <Text style={[styles.name, { color: pctColor(s.avg) }]}>{s.avg}%</Text>
                    </View>
                    <View style={styles.barBg}><View style={[styles.barFillH, { width: `${Math.min(s.avg, 100)}%`, backgroundColor: pctColor(s.avg) }]} /></View>
                  </View>
                ))}
            </Card>

            <Card title={`2 ya zyada exam mein fail (${data.exams.repeat_fail.length})`}>
              {data.exams.repeat_fail.length === 0 ? <Text style={styles.empty}>Koi nahi 👍</Text> :
                data.exams.repeat_fail.map((r: any) => (
                  <Pressable key={r.connection_id} style={styles.listRow} onPress={() => router.push(`/teacher/student/${r.connection_id}` as any)}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{r.name}</Text>
                      <Text style={styles.meta}>{r.class_name}</Text>
                    </View>
                    <Text style={[styles.amt, { color: "#EF4444" }]}>{r.fails} fail</Text>
                  </Pressable>
                ))}
            </Card>

            <Card title="Toppers (saare exams milake) 🏆">
              {data.exams.toppers.length === 0 ? <Text style={styles.empty}>Abhi data nahi hai.</Text> :
                data.exams.toppers.map((t: any, i: number) => (
                  <View key={t.connection_id} style={styles.listRow}>
                    <Text style={styles.rank}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{t.name}</Text>
                      <Text style={styles.meta}>{t.class_name} • {t.exams} exam</Text>
                    </View>
                    <Text style={[styles.amt, { color: "#10B981" }]}>{t.avg}%</Text>
                  </View>
                ))}
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sect}>{title}</Text>
      {children}
    </View>
  );
}

function Stat({ icon, color, label, value, sub, subColor }: { icon: any; color: string; label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <View style={styles.stat}>
      <View style={[styles.statIcon, { backgroundColor: color + "26" }]}><Ionicons name={icon} size={18} color={color} /></View>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sub ? <Text style={[styles.statSub, { color: subColor || DARK.sub }]}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  title: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "800" },
  retry: { marginTop: SPACING.lg, paddingHorizontal: 20, height: 42, borderRadius: 12, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", marginHorizontal: SPACING.md, marginBottom: SPACING.xs, backgroundColor: DARK.input, borderRadius: 12, padding: 3 },
  tabBtn: { flex: 1, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: "#7C3AED" },
  tabTxt: { color: DARK.sub, fontWeight: "700", fontSize: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm },
  stat: { width: "48.5%", flexGrow: 1, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border, gap: 4 },
  statIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  statLabel: { color: DARK.sub, fontSize: 11 },
  statValue: { color: "#fff", fontSize: 20, fontWeight: "800" },
  statSub: { fontSize: 11, fontWeight: "700" },
  todayBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: "rgba(245,158,11,0.1)", borderWidth: 1, borderColor: "rgba(245,158,11,0.3)" },
  todayTxt: { color: DARK.sub, fontSize: 13 },
  card: { padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border },
  sect: { color: DARK.sub, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  empty: { color: DARK.sub, marginTop: SPACING.sm, fontSize: 13 },
  insightRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  insightIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  insightTxt: { flex: 1, color: "rgba(255,255,255,0.88)", fontSize: 13, lineHeight: 18 },
  chart: { flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md, height: 180 },
  bar: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  barTrack: { width: "70%", height: 120, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 8, justifyContent: "flex-end", overflow: "hidden" },
  barFill: { backgroundColor: "#7C3AED", borderRadius: 8 },
  barLbl: { color: DARK.sub, fontSize: 11 },
  barAmt: { color: "#fff", fontSize: 10, fontWeight: "700" },
  listRow: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: DARK.border, marginTop: SPACING.sm },
  name: { color: "#fff", fontWeight: "700", fontSize: 14 },
  meta: { color: DARK.sub, fontSize: 11, marginTop: 2 },
  amt: { fontWeight: "800", fontSize: 15 },
  rank: { width: 28, textAlign: "center", color: "#fff", fontWeight: "800", fontSize: 15 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  barBg: { height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.1)", overflow: "hidden", marginTop: 6 },
  barFillH: { height: 6, borderRadius: 3 },
  reasonWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  reasonChip: { paddingHorizontal: 8, height: 22, borderRadius: 11, backgroundColor: "rgba(239,68,68,0.15)", alignItems: "center", justifyContent: "center" },
  reasonTxt: { color: "#F87171", fontSize: 11, fontWeight: "700" },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12 },
  actionTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  waBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: "rgba(37,211,102,0.12)", alignItems: "center", justifyContent: "center" },
});
