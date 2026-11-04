import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { ReportCardView } from "@/src/components/ReportCardView";

// Teacher: the full report card of one student (all exams, rank, subjects, attendance).
export function ReportCardSheet({ visible, onClose, connectionId, bottomInset }: { visible: boolean; onClose: () => void; connectionId: string | null; bottomInset: number }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null); setErr("");
    if (!visible || !connectionId) return;
    let live = true;
    api(`/teacher/students/${connectionId}/report-card`).then((r) => live && setData(r)).catch((e) => live && setErr(e?.message || "Could not load the report card."));
    return () => { live = false; };
  }, [visible, connectionId]);
  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 14 }]}>
          <View style={s.head}><Text style={s.title}>Report card</Text><Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable></View>
          {err ? <Text style={s.err}>{err}</Text> : !data ? <ActivityIndicator color="#1F6BFF" style={{ margin: 30 }} /> : <ScrollView showsVerticalScrollIndicator={false}><ReportCardView data={data} /></ScrollView>}
        </View>
      </View>
    </InlineOverlay>
  );
}
const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#F1F5F9", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, maxHeight: "92%" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  err: { color: "#B91C1C", padding: 20, textAlign: "center" },
});
