import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";

// Teacher: automatic payment messages. Settings + the WhatsApp messages that are ready to send with one tap.
export function AutoMessagesSheet({ visible, onClose, bottomInset, onChanged }: { visible: boolean; onClose: () => void; bottomInset: number; onChanged: () => void }) {
  const [cfg, setCfg] = useState<any>(null);
  const [queue, setQueue] = useState<any[]>([]);
  const [err, setErr] = useState("");
  const load = useCallback(async () => {
    setErr("");
    try { const [c, q]: any = await Promise.all([api("/teacher/auto-messages"), api("/teacher/whatsapp/queue")]); setCfg(c); setQueue(q || []); }
    catch (e: any) { setErr(e?.message || "Could not load."); }
  }, []);
  useEffect(() => { if (visible) { setCfg(null); load(); } }, [visible, load]);

  const toggle = async (k: "whatsapp" | "month_complete", v: boolean) => {
    setCfg((p: any) => ({ ...p, prefs: { ...p.prefs, [k]: v } }));
    try { await api("/teacher/auto-messages", { method: "PUT", body: { [k]: v } }); } catch (e: any) { Alert.alert("Could not save", e?.message || ""); load(); }
  };
  const sendOne = async (q: any) => {
    const { Linking } = require("react-native");
    try { await Linking.openURL(`https://wa.me/${q.phone}?text=${encodeURIComponent(q.text)}`); await api(`/teacher/whatsapp/queue/${q.id}/sent`, { method: "POST" }); setQueue((p) => p.filter((x) => x.id !== q.id)); onChanged(); }
    catch { Alert.alert("Could not open WhatsApp"); }
  };
  const dismiss = async (q: any) => { try { await api(`/teacher/whatsapp/queue/${q.id}/dismiss`, { method: "POST" }); setQueue((p) => p.filter((x) => x.id !== q.id)); onChanged(); } catch {} };

  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}><View style={{ flex: 1 }}><Text style={s.title}>Automatic messages</Text><Text style={s.sub}>Sent when a payment is recorded or confirmed</Text></View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable></View>
          {err ? <Text style={s.err}>{err}</Text> : !cfg ? <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} /> : (
            <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
              <View style={s.card}>
                <View style={s.info}><Ionicons name="checkmark-circle" size={18} color="#16A34A" /><Text style={s.infoTxt}>In the app: the student always gets "Payment received" with the receipt number.</Text></View>
                <View style={s.sw}><View style={{ flex: 1 }}><Text style={s.swT}>Tell when a month is fully paid</Text><Text style={s.swS}>In-app message and a 🎉 line in WhatsApp</Text></View>
                  <Switch value={!!cfg.prefs.month_complete} onValueChange={(v) => toggle("month_complete", v)} /></View>
                <View style={s.sw}><View style={{ flex: 1 }}><Text style={s.swT}>Prepare a WhatsApp message</Text><Text style={s.swS}>For the parent's number (or the student's)</Text></View>
                  <Switch value={!!cfg.prefs.whatsapp} onValueChange={(v) => toggle("whatsapp", v)} /></View>
                <View style={[s.info, { backgroundColor: cfg.whatsapp_configured ? "#ECFDF5" : "#FEF3C7" }]}>
                  <Ionicons name={cfg.whatsapp_configured ? "flash" : "hand-left"} size={18} color={cfg.whatsapp_configured ? "#16A34A" : "#B45309"} />
                  <Text style={[s.infoTxt, { color: cfg.whatsapp_configured ? "#166534" : "#92400E" }]}>{cfg.whatsapp_configured ? "WhatsApp is connected: messages are sent automatically." : "WhatsApp is not connected yet, so messages wait below and you send each one with one tap."}</Text>
                </View>
              </View>

              <Text style={s.lbl}>Ready to send on WhatsApp ({queue.length})</Text>
              {queue.length === 0 ? <Text style={s.empty}>Nothing waiting. New payment messages will appear here.</Text> : queue.map((q) => (
                <View key={q.id} style={s.q}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.qName}>{q.name}  {q.kind === "month_complete" ? "🎉" : ""}</Text>
                    <Text style={s.qTxt} numberOfLines={3}>{q.text}</Text>
                    {q.error ? <Text style={s.qErr}>Auto-send failed: {q.error}</Text> : null}
                  </View>
                  <View style={{ gap: 6 }}>
                    <Pressable onPress={() => sendOne(q)} style={s.send} testID={`wa-send-${q.id}`}><Ionicons name="logo-whatsapp" size={16} color="#fff" /><Text style={s.sendTxt}>Send</Text></Pressable>
                    <Pressable onPress={() => dismiss(q)} style={s.skip}><Text style={s.skipTxt}>Skip</Text></Pressable>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </InlineOverlay>
  );
}
const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  card: { backgroundColor: "#F8FAFC", borderRadius: 14, padding: 10, gap: 8, borderWidth: 1, borderColor: "#E2E8F0" },
  info: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: "#ECFDF5", borderRadius: 10, padding: 10 },
  infoTxt: { flex: 1, fontSize: 12.5, color: "#166534", lineHeight: 17 },
  sw: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  swT: { fontWeight: "800", color: "#0F172A", fontSize: 14 },
  swS: { color: "#64748B", fontSize: 12, marginTop: 2 },
  lbl: { color: "#1F6BFF", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  empty: { color: "#64748B", textAlign: "center", padding: 18 },
  q: { flexDirection: "row", gap: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 14, padding: 10, marginBottom: 8, alignItems: "center" },
  qName: { fontWeight: "800", color: "#0F172A", fontSize: 14 },
  qTxt: { color: "#475569", fontSize: 12.5, lineHeight: 17, marginTop: 3 },
  qErr: { color: "#B91C1C", fontSize: 11.5, marginTop: 4 },
  send: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#22C55E", borderRadius: 10, paddingHorizontal: 12, height: 36 },
  sendTxt: { color: "#fff", fontWeight: "800", fontSize: 13 },
  skip: { alignItems: "center", paddingVertical: 4 },
  skipTxt: { color: "#94A3B8", fontWeight: "700", fontSize: 12 },
  err: { color: "#B91C1C", padding: 18, textAlign: "center" },
});
