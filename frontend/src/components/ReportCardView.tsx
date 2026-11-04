import React from "react";
import { Share, StyleSheet, Text, View, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

// The report card (used by the student's "Results" screen and by the teacher's sheet). data = response of /student/report-card.
export const gradeColor = (g?: string | null) => (g === "A+" || g === "A" ? "#16A34A" : g === "B+" || g === "B" ? "#2563EB" : g === "C" || g === "D" ? "#D97706" : g === "F" ? "#DC2626" : "#64748B");
const TREND: Record<string, { t: string; c: string; i: any }> = {
  improving: { t: "Improving", c: "#16A34A", i: "trending-up" },
  falling: { t: "Going down", c: "#DC2626", i: "trending-down" },
  steady: { t: "Steady", c: "#2563EB", i: "remove" },
};
const num = (n: number | null | undefined) => (n == null ? "-" : n % 1 === 0 ? String(n) : n.toFixed(1));

export function reportCardText(d: any): string {
  const s = d.summary || {};
  const lines = (d.exams || []).map((e: any) => e.absent ? `• ${e.title}: Absent` : `• ${e.title}${e.subject ? " (" + e.subject + ")" : ""}: ${num(e.marks)}/${num(e.total)} - ${e.percentage}% ${e.grade}${e.rank ? ` - Rank ${e.rank}/${e.class_size}` : ""}`);
  return `📄 Report Card - ${d.student?.name}${d.student?.class ? " (" + d.student.class + ")" : ""}\n${d.institute || ""}\n\n` +
    (s.percentage != null ? `Overall: ${num(s.total_marks)}/${num(s.out_of)} = ${s.percentage}% - Grade ${s.grade}\n` : "") +
    (d.attendance?.overall_pct != null ? `Attendance: ${d.attendance.overall_pct}%\n` : "") + `\n${lines.join("\n")}\n\n${s.remark || ""}`;
}

export function ReportCardView({ data }: { data: any }) {
  const s = data?.summary || {};
  const exams = [...(data?.exams || [])].reverse();
  const tr = s.trend ? TREND[s.trend] : null;
  return (
    <View style={{ gap: 12 }}>
      <View style={st.hero}>
        <Text style={st.name}>{data?.student?.name}</Text>
        <Text style={st.sub}>{[data?.student?.class, data?.student?.admission_number, data?.institute].filter(Boolean).join("  •  ")}</Text>
        {s.percentage != null ? (
          <View style={st.heroRow}>
            <View style={{ flex: 1 }}>
              <Text style={st.big}>{s.percentage}%</Text>
              <Text style={st.sub}>{num(s.total_marks)} / {num(s.out_of)} marks in {s.exams_taken} exam{s.exams_taken === 1 ? "" : "s"}</Text>
              {tr ? <View style={st.trend}><Ionicons name={tr.i} size={14} color="#fff" /><Text style={st.trendTxt}>{tr.t}</Text></View> : null}
            </View>
            <View style={[st.gradeBox, { backgroundColor: "#fff" }]}><Text style={[st.grade, { color: gradeColor(s.grade) }]}>{s.grade}</Text><Text style={st.gradeLbl}>Grade</Text></View>
          </View>
        ) : <Text style={[st.sub, { marginTop: 10 }]}>No marks yet. Results will appear here after the teacher enters them.</Text>}
      </View>

      {s.percentage != null ? (
        <View style={st.row3}>
          <Stat label="Passed" v={String(s.passed)} c="#16A34A" />
          <Stat label="Failed" v={String(s.failed)} c={s.failed ? "#DC2626" : "#64748B"} />
          <Stat label="Attendance" v={data?.attendance?.overall_pct != null ? `${data.attendance.overall_pct}%` : "-"} c="#0D9488" />
        </View>
      ) : null}
      {s.remark ? <View style={st.remark}><Ionicons name="chatbubble-ellipses" size={16} color="#1D4ED8" /><Text style={st.remarkTxt}>{s.remark}</Text></View> : null}

      {(data?.subjects || []).length > 0 ? (
        <View style={st.card}>
          <Text style={st.h}>Subjects{s.best_subject ? `  •  Best: ${s.best_subject}` : ""}{s.weakest_subject ? `  •  Needs work: ${s.weakest_subject}` : ""}</Text>
          {data.subjects.map((x: any) => (
            <View key={x.subject} style={{ marginTop: 10 }}>
              <View style={st.rowBetween}><Text style={st.subj}>{x.subject}</Text><Text style={[st.subj, { color: gradeColor(x.grade) }]}>{x.percentage}%  {x.grade}</Text></View>
              <View style={st.bar}><View style={[st.fill, { width: `${Math.min(100, x.percentage)}%`, backgroundColor: gradeColor(x.grade) }]} /></View>
            </View>
          ))}
        </View>
      ) : null}

      {exams.map((e: any) => (
        <View key={e.exam_id} style={st.card}>
          <View style={st.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={st.exTitle}>{e.title}</Text>
              <Text style={st.sub2}>{[e.subject, e.date].filter(Boolean).join("  •  ")}</Text>
            </View>
            {e.absent ? <View style={[st.pill, { backgroundColor: "#F1F5F9" }]}><Text style={[st.pillTxt, { color: "#64748B" }]}>Absent</Text></View>
              : <View style={[st.pill, { backgroundColor: gradeColor(e.grade) + "22" }]}><Text style={[st.pillTxt, { color: gradeColor(e.grade) }]}>{e.grade}</Text></View>}
          </View>
          {!e.absent ? (
            <>
              <Text style={st.marks}>{num(e.marks)}<Text style={st.of}> / {num(e.total)}</Text>   <Text style={{ color: e.result === "pass" ? "#16A34A" : "#DC2626", fontSize: 14, fontWeight: "800" }}>{e.percentage}% {e.result === "pass" ? "Pass" : "Fail"}</Text></Text>
              <View style={st.bar}><View style={[st.fill, { width: `${Math.min(100, e.percentage)}%`, backgroundColor: gradeColor(e.grade) }]} />
                {e.class_avg_pct != null ? <View style={[st.avgTick, { left: `${Math.min(99, e.class_avg_pct)}%` }]} /> : null}</View>
              <Text style={st.sub2}>{e.rank ? `Rank ${e.rank} of ${e.class_size}` : ""}{e.class_avg_pct != null ? `${e.rank ? "  •  " : ""}Class average ${e.class_avg_pct}% (marked on the bar)` : ""}</Text>
            </>
          ) : null}
          {e.remark ? <Text style={st.exRemark}>Teacher: {e.remark}</Text> : null}
        </View>
      ))}

      {(data?.exams || []).length > 0 ? (
        <Pressable onPress={() => Share.share({ message: reportCardText(data) }).catch(() => {})} style={st.share} testID="rc-share">
          <Ionicons name="share-social" size={17} color="#1F6BFF" /><Text style={st.shareTxt}>Share report card</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Stat({ label, v, c }: { label: string; v: string; c: string }) {
  return <View style={st.stat}><Text style={[st.statV, { color: c }]}>{v}</Text><Text style={st.statL}>{label}</Text></View>;
}

const st = StyleSheet.create({
  hero: { backgroundColor: "#1F4FD8", borderRadius: 20, padding: 18 },
  name: { color: "#fff", fontSize: 20, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 3 },
  heroRow: { flexDirection: "row", alignItems: "center", marginTop: 14, gap: 12 },
  big: { color: "#fff", fontSize: 44, fontWeight: "900" },
  trend: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 },
  trendTxt: { color: "#fff", fontWeight: "800", fontSize: 12 },
  gradeBox: { width: 78, height: 78, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  grade: { fontSize: 32, fontWeight: "900" },
  gradeLbl: { fontSize: 10, fontWeight: "800", color: "#64748B", marginTop: -2 },
  row3: { flexDirection: "row", gap: 10 },
  stat: { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 12, alignItems: "center", borderWidth: 1, borderColor: "#E2E8F0" },
  statV: { fontSize: 20, fontWeight: "900" },
  statL: { fontSize: 11, color: "#64748B", marginTop: 2, fontWeight: "700" },
  remark: { flexDirection: "row", gap: 8, backgroundColor: "#EFF6FF", borderRadius: 14, padding: 12, alignItems: "flex-start" },
  remarkTxt: { flex: 1, color: "#1E3A8A", fontSize: 13, lineHeight: 19, fontWeight: "600" },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 14, borderWidth: 1, borderColor: "#E2E8F0", gap: 6 },
  h: { color: "#0F172A", fontWeight: "800", fontSize: 13 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  subj: { fontSize: 13, fontWeight: "800", color: "#0F172A" },
  bar: { height: 8, borderRadius: 4, backgroundColor: "#E2E8F0", marginTop: 4, overflow: "visible" },
  fill: { height: 8, borderRadius: 4 },
  avgTick: { position: "absolute", top: -3, width: 3, height: 14, borderRadius: 2, backgroundColor: "#0F172A" },
  exTitle: { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  sub2: { fontSize: 12, color: "#64748B" },
  pill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  pillTxt: { fontWeight: "900", fontSize: 14 },
  marks: { fontSize: 24, fontWeight: "900", color: "#0F172A" },
  of: { fontSize: 14, color: "#64748B", fontWeight: "700" },
  exRemark: { fontSize: 12.5, color: "#334155", fontStyle: "italic" },
  share: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: "#BFD7FF", backgroundColor: "#fff" },
  shareTxt: { color: "#1F6BFF", fontWeight: "800", fontSize: 14 },
});
