import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { callPhone, openWhatsApp } from "@/src/lib/contact";

const TH = [60, 75, 85];

// Teacher: students whose attendance in the month is below a limit, with one-tap alert, call and WhatsApp.
export function LowAttendanceSheet({ visible, onClose, month, bottomInset }: { visible: boolean; onClose: () => void; month: string; bottomInset: number }) {
  const [th, setTh] = useState(75);
  const [data, setData] = useState<any>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setData(null); setErr("");
    try { const r: any = await api(`/teacher/attendance/low?month=${month}&threshold=${th}`); setData(r); setSel(Object.fromEntries((r.items || []).map((i: any) => [i.connection_id, true]))); }
    catch (e: any) { setErr(e?.message || "Could not load."); }
  }, [month, th]);
  useEffect(() => { if (visible) load(); }, [visible, load]);

  const ids = Object.keys(sel).filter((k) => sel[k]);
  const alertAll = async () => {
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      const r: any = await api("/teacher/attendance/alert", { method: "POST", body: { connection_ids: ids, month } });
      Alert.alert("Alerts sent", `${r.sent} student${r.sent === 1 ? "" : "s"} notified.${r.skipped?.length ? `\n${r.skipped.length} skipped (already alerted today).` : ""}`);
    } catch (e: any) { Alert.alert("Could not send", e?.message || "Please try again."); }
    setBusy(false);
  };

  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}><View style={{ flex: 1 }}><Text style={s.title}>Low attendance</Text><Text style={s.sub}>{month}  •  below {th}%</Text></View><Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable></View>
          <View style={s.seg}>{TH.map((t) => <Pressable key={t} onPress={() => setTh(t)} style={[s.segBtn, th === t && s.segOn]}><Text style={[s.segTxt, th === t && { color: "#fff" }]}>Below {t}%</Text></Pressable>)}</View>
          {err ? <Text style={s.err}>{err}</Text> : !data ? <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} /> : data.items.length === 0 ? (
            <View style={{ alignItems: "center", padding: 28 }}><Ionicons name="happy-outline" size={44} color="#16A34A" /><Text style={s.good}>Everyone is above {th}% this month.</Text></View>
          ) : (
            <>
              <ScrollView style={{ maxHeight: 420 }}>
                {data.items.map((i: any) => (
                  <View key={i.connection_id} style={s.row}>
                    <Pressable onPress={() => setSel((p) => ({ ...p, [i.connection_id]: !p[i.connection_id] }))} hitSlop={8}>
                      <Ionicons name={sel[i.connection_id] ? "checkbox" : "square-outline"} size={24} color={sel[i.connection_id] ? "#1F6BFF" : "#94A3B8"} />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>{i.name}</Text>
                      <Text style={s.meta}>{i.absent} absent in {i.days} days{i.absent_streak >= 2 ? `  •  ${i.absent_streak} in a row` : ""}</Text>
                    </View>
                    <Text style={[s.pct, { color: i.pct < 60 ? "#DC2626" : "#D97706" }]}>{i.pct}%</Text>
                    <Pressable onPress={() => callPhone(i.phone)} hitSlop={6} style={s.mini}><Ionicons name="call" size={15} color="#16A34A" /></Pressable>
                    <Pressable onPress={() => openWhatsApp(i.phone, `Hello, ${i.name}'s attendance this month is ${i.pct}% (${i.absent} absent). Please make sure they attend regularly. Thank you.`)} hitSlop={6} style={[s.mini, { backgroundColor: "#DCFCE7" }]}><Ionicons name="logo-whatsapp" size={15} color="#16A34A" /></Pressable>
                  </View>
                ))}
              </ScrollView>
              <Pressable onPress={alertAll} disabled={busy || !ids.length} style={[s.go, (busy || !ids.length) && { opacity: 0.5 }]} testID="low-alert-send">
                {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="notifications" size={17} color="#fff" /><Text style={s.goTxt}>Notify {ids.length} student{ids.length === 1 ? "" : "s"} in the app</Text></>}
              </Pressable>
            </>
          )}
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
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 11 },
  segOn: { backgroundColor: "#1F6BFF" },
  segTxt: { fontWeight: "800", color: "#1F6BFF", fontSize: 12.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#EEF2F7" },
  name: { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  meta: { fontSize: 12, color: "#64748B", marginTop: 2 },
  pct: { fontSize: 16, fontWeight: "900" },
  mini: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center" },
  go: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, backgroundColor: "#1F6BFF", marginTop: 12 },
  goTxt: { color: "#fff", fontWeight: "800", fontSize: 14.5 },
  good: { color: "#166534", fontWeight: "700", marginTop: 8, textAlign: "center" },
  err: { color: "#B91C1C", padding: 18, textAlign: "center" },
});
