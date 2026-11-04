import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { Avatar } from "@/src/components/Avatar";
import { callPhone, openWhatsApp } from "@/src/lib/contact";

const inr = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
const ST: Record<string, string> = { present: "#16A34A", absent: "#DC2626", late: "#D97706", leave: "#2563EB" };

// Teacher: one student at a glance (attendance, fees, exams, homework) with call / WhatsApp / report card / full profile.
export function StudentQuickSheet({ visible, onClose, item, bottomInset, onOpenProfile, onOpenReport }: {
  visible: boolean; onClose: () => void; item: any; bottomInset: number; onOpenProfile: (id: string) => void; onOpenReport: (id: string) => void;
}) {
  const [o, setO] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setO(null); setErr("");
    if (!visible || !item) return;
    let live = true;
    api(`/teacher/students/${item.id}/overview`).then((r) => live && setO(r)).catch((e) => live && setErr(e?.message || "Could not load."));
    return () => { live = false; };
  }, [visible, item?.id]);

  const s = item?.student || {};
  const due = o?.fees?.due ?? item?.due ?? 0;
  const msg = `Hello, this is a reminder from ${"the coaching"}: fees of ${inr(due)} are pending for ${s.name || "your child"}. Please pay at the earliest. Thank you.`;

  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={st.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[st.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={st.head}>
            <Avatar name={s.name} uri={s.photo_url} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={st.name}>{s.name || "Student"}</Text>
              <Text style={st.sub}>{item?.admission_number}{s.phone ? `  •  ${s.phone}` : ""}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable>
          </View>

          <View style={st.actions}>
            <Act icon="call" label="Call" color="#16A34A" onPress={() => callPhone(s.phone)} />
            <Act icon="logo-whatsapp" label={due > 0 ? "Remind fee" : "WhatsApp"} color="#22C55E" onPress={() => openWhatsApp(s.phone, due > 0 ? msg : `Hello, regarding ${s.name || "your child"}: `)} />
            <Act icon="ribbon" label="Report card" color="#F59E0B" onPress={() => { onClose(); onOpenReport(item.id); }} />
            <Act icon="person" label="Profile" color="#1F6BFF" onPress={() => { onClose(); onOpenProfile(item.id); }} />
          </View>

          {err ? <Text style={st.err}>{err}</Text> : !o ? <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} /> : (
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
              <Card title="Attendance" icon="calendar" color="#0D9488">
                <Text style={st.big}>{o.attendance.month_pct != null ? `${o.attendance.month_pct}%` : "-"}<Text style={st.small}>  this month</Text></Text>
                <Text style={st.line}>Overall {o.attendance.overall_pct != null ? `${o.attendance.overall_pct}%` : "-"}{o.attendance.absent_streak >= 2 ? `  •  ${o.attendance.absent_streak} days absent in a row` : ""}</Text>
                <View style={st.dots}>{(o.attendance.recent || []).map((r: any) => <View key={r.date} style={[st.dot, { backgroundColor: ST[r.status] || "#CBD5E1" }]} />)}</View>
              </Card>
              <Card title="Fees" icon="wallet" color="#EC4899">
                <Text style={[st.big, { color: o.fees.due > 0 ? "#DC2626" : "#16A34A" }]}>{o.fees.due > 0 ? inr(o.fees.due) + " due" : "All paid"}</Text>
                <Text style={st.line}>Billed {inr(o.fees.billed)}  •  Paid {inr(o.fees.paid)}{o.fees.last_payment ? `  •  Last payment ${o.fees.last_payment}` : ""}</Text>
              </Card>
              <Card title="Exams" icon="ribbon" color="#F59E0B">
                <Text style={st.big}>{o.exams.average_pct != null ? `${o.exams.average_pct}%` : "-"}<Text style={st.small}>  average of {o.exams.count} exam{o.exams.count === 1 ? "" : "s"}</Text></Text>
                {o.exams.last ? <Text style={st.line}>Last: {o.exams.last.title}{o.exams.last.subject ? ` (${o.exams.last.subject})` : ""} - {o.exams.last.percentage}%</Text> : null}
              </Card>
              <Card title="Homework" icon="clipboard" color="#6366F1">
                <Text style={st.big}>{o.homework.sent}<Text style={st.small}> of {o.homework.assigned} sent</Text></Text>
                <Text style={st.line}>{o.homework.checked} checked{o.homework.redo ? `  •  ${o.homework.redo} to redo` : ""}{o.homework.overdue_not_sent ? `  •  ${o.homework.overdue_not_sent} overdue, not sent` : ""}</Text>
              </Card>
            </ScrollView>
          )}
        </View>
      </View>
    </InlineOverlay>
  );
}

function Act({ icon, label, color, onPress }: { icon: any; label: string; color: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={st.act}><View style={[st.actIc, { backgroundColor: color + "1F" }]}><Ionicons name={icon} size={20} color={color} /></View><Text style={st.actTxt}>{label}</Text></Pressable>;
}
function Card({ title, icon, color, children }: { title: string; icon: any; color: string; children: React.ReactNode }) {
  return <View style={st.card}><View style={st.cardHead}><Ionicons name={icon} size={14} color={color} /><Text style={[st.cardTitle, { color }]}>{title}</Text></View>{children}</View>;
}

const st = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  actions: { flexDirection: "row", justifyContent: "space-between", marginTop: 14, marginBottom: 6 },
  act: { flex: 1, alignItems: "center", gap: 5 },
  actIc: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  actTxt: { fontSize: 11.5, fontWeight: "700", color: "#334155" },
  card: { backgroundColor: "#F8FAFC", borderRadius: 14, padding: 12, marginTop: 10, borderWidth: 1, borderColor: "#E2E8F0" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  cardTitle: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  big: { fontSize: 22, fontWeight: "900", color: "#0F172A" },
  small: { fontSize: 12, fontWeight: "600", color: "#64748B" },
  line: { fontSize: 12.5, color: "#475569", marginTop: 3 },
  dots: { flexDirection: "row", gap: 6, marginTop: 8 },
  dot: { width: 14, height: 14, borderRadius: 7 },
  err: { color: "#B91C1C", padding: 18, textAlign: "center" },
});
