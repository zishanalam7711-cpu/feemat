import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/lib/api";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { callPhone, openWhatsApp } from "@/src/lib/contact";

const inr = (n: number) => "₹" + Math.round(n || 0).toLocaleString("en-IN");

function Sheet({ visible, onClose, title, sub, bottomInset, children }: { visible: boolean; onClose: () => void; title: string; sub?: string; bottomInset: number; children: React.ReactNode }) {
  return (
    <InlineOverlay visible={visible} onClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: bottomInset + 16 }]}>
          <View style={s.head}><View style={{ flex: 1 }}><Text style={s.title}>{title}</Text>{sub ? <Text style={s.sub}>{sub}</Text> : null}</View>
            <Pressable onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#64748B" /></Pressable></View>
          {children}
        </View>
      </View>
    </InlineOverlay>
  );
}

// ---------------------------------------------------------------------------------------------- late fee
export function LateFeeSheet({ visible, onClose, bottomInset, onApplied }: { visible: boolean; onClose: () => void; bottomInset: number; onApplied: () => void }) {
  const [p, setP] = useState<any>(null);
  const [pv, setPv] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [cap, setCap] = useState("");
  const [grace, setGrace] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const [pol, prev]: any = await Promise.all([api("/teacher/fees/late-fee"), api("/teacher/fees/late-fee/preview")]);
      setP(pol); setPv(prev); setAmount(String(pol.amount)); setCap(pol.cap ? String(pol.cap) : ""); setGrace(String(pol.grace_day));
    } catch (e: any) { setErr(e?.message || "Could not load."); }
  }, []);
  useEffect(() => { if (visible) { setP(null); setPv(null); load(); } }, [visible, load]);

  const save = async (patch: any) => {
    setBusy(true); setErr("");
    try { const r: any = await api("/teacher/fees/late-fee", { method: "PUT", body: patch }); setP(r); await load(); }
    catch (e: any) { setErr(e?.message || "Could not save."); }
    setBusy(false);
  };
  const saveAll = () => save({ enabled: p.enabled, kind: p.kind, amount: parseFloat(amount), grace_day: parseInt(grace, 10), cap: cap.trim() === "" ? null : parseFloat(cap) });
  const apply = () => {
    if (!pv?.items?.length) return;
    Alert.alert("Add late fee?", `${pv.items.length} fee month${pv.items.length === 1 ? "" : "s"} will get a late fee, ${inr(pv.total)} in total. Students are notified. This is done once per month.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Add late fee", onPress: async () => {
        setBusy(true);
        try { const r: any = await api("/teacher/fees/late-fee/apply", { method: "POST" }); Alert.alert("Done", `Late fee added to ${r.applied} fee month${r.applied === 1 ? "" : "s"} (${inr(r.total)}).`); onApplied(); await load(); }
        catch (e: any) { Alert.alert("Could not add", e?.message || ""); }
        setBusy(false);
      } },
    ]);
  };
  const forgive = async (i: any) => { try { await api(`/teacher/fees/late-fee/${i.fee_month_id}/remove`, { method: "POST" }); onApplied(); await load(); } catch (e: any) { Alert.alert("Could not remove", e?.message || ""); } };

  return (
    <Sheet visible={visible} onClose={onClose} title="Late fee" sub="Add a fine when fees are not paid in time" bottomInset={bottomInset}>
      {!p ? (err ? <Text style={s.err}>{err}</Text> : <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} />) : (
        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
          <View style={s.switchRow}><View style={{ flex: 1 }}><Text style={s.rowTitle}>Charge late fee</Text><Text style={s.rowSub}>You choose when to add it. Nothing is added automatically.</Text></View>
            <Switch value={!!p.enabled} onValueChange={(v) => save({ enabled: v })} disabled={busy} /></View>
          <Text style={s.lbl}>Fee should be paid by day … of the month</Text>
          <TextInput value={grace} onChangeText={setGrace} keyboardType="number-pad" style={s.input} placeholder="10" />
          <Text style={s.lbl}>Late fee type</Text>
          <View style={s.wrap}>{([["flat", "Fixed amount"], ["percent", "% of unpaid fee"]] as [string, string][]).map(([k, l]) => (
            <Pressable key={k} onPress={() => setP({ ...p, kind: k })} style={[s.chip, p.kind === k && s.chipOn]}><Text style={[s.chipTxt, p.kind === k && { color: "#fff" }]}>{l}</Text></Pressable>))}</View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}><Text style={s.lbl}>{p.kind === "percent" ? "Percent" : "Amount (₹)"}</Text><TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" style={s.input} /></View>
            <View style={{ flex: 1 }}><Text style={s.lbl}>Maximum (₹, optional)</Text><TextInput value={cap} onChangeText={setCap} keyboardType="numeric" style={s.input} placeholder="No limit" placeholderTextColor="#94A3B8" /></View>
          </View>
          {err ? <Text style={s.err}>{err}</Text> : null}
          <Pressable onPress={saveAll} disabled={busy} style={[s.btnLight, busy && { opacity: 0.5 }]}><Text style={s.btnLightTxt}>Save settings</Text></Pressable>

          {pv?.enabled ? (
            <View style={{ marginTop: 14 }}>
              <Text style={s.lbl}>Right now</Text>
              {pv.items.length === 0 ? <Text style={s.rowSub}>No fee month needs a late fee today.</Text> : (
                <>
                  {pv.items.slice(0, 8).map((i: any) => (
                    <View key={i.fee_month_id} style={s.item}><Text style={s.itemTxt}>{i.name}  •  {i.month}</Text><Text style={s.itemAmt}>+{inr(i.late_fee)}</Text></View>
                  ))}
                  {pv.items.length > 8 ? <Text style={s.rowSub}>and {pv.items.length - 8} more</Text> : null}
                  <Pressable onPress={apply} disabled={busy} style={[s.btn, busy && { opacity: 0.5 }]} testID="late-fee-apply"><Ionicons name="add-circle" size={18} color="#fff" /><Text style={s.btnTxt}>Add late fee to {pv.items.length} ({inr(pv.total)})</Text></Pressable>
                </>
              )}
            </View>
          ) : null}
          <Text style={[s.rowSub, { marginTop: 12 }]}>A late fee can be removed for one student by opening the student's fee month and choosing "Remove late fee".</Text>
        </ScrollView>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------------------------------------- reminder centre
export function ReminderCenterSheet({ visible, onClose, bottomInset }: { visible: boolean; onClose: () => void; bottomInset: number }) {
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [tmpl, setTmpl] = useState("");
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try { const r: any = await api("/teacher/reminders/center"); setD(r); setTmpl(r.settings.template); setSel(Object.fromEntries(r.items.map((i: any) => [i.connection_id, true]))); }
    catch (e: any) { setErr(e?.message || "Could not load."); }
  }, []);
  useEffect(() => { if (visible) { setD(null); setEdit(false); load(); } }, [visible, load]);

  const ids = Object.keys(sel).filter((k) => sel[k]);
  const saveTemplate = async () => {
    try { await api("/teacher/reminders/settings", { method: "PUT", body: { template: tmpl } }); setEdit(false); await load(); } catch (e: any) { Alert.alert("Could not save", e?.message || ""); }
  };
  const sendApp = async () => {
    if (!ids.length || busy) return;
    setBusy(true);
    try { const r: any = await api("/teacher/reminders/send", { method: "POST", body: { connection_ids: ids } });
      Alert.alert("Reminders sent", `${r.sent} student${r.sent === 1 ? "" : "s"} reminded in the app.${r.skipped?.length ? `\n${r.skipped.length} skipped (reminded recently or nothing pending).` : ""}`); await load(); }
    catch (e: any) { Alert.alert("Could not send", e?.message || ""); }
    setBusy(false);
  };
  const whatsapp = async (i: any) => {
    openWhatsApp(i.phone, i.message);
    try { await api("/teacher/reminders/log", { method: "POST", body: { connection_ids: [i.connection_id], channel: "whatsapp" } }); await load(); } catch {}
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Fee reminders" sub={d ? `${d.items.length} student${d.items.length === 1 ? "" : "s"} with pending fees  •  ${inr(d.total_due)}` : ""} bottomInset={bottomInset}>
      {!d ? (err ? <Text style={s.err}>{err}</Text> : <ActivityIndicator color="#1F6BFF" style={{ margin: 24 }} />) : (
        <>
          <Pressable onPress={() => setEdit(!edit)} style={s.msgBtn}><Ionicons name="create-outline" size={16} color="#1F6BFF" /><Text style={s.msgBtnTxt}>{edit ? "Close message editor" : "Edit reminder message"}</Text></Pressable>
          {edit ? (
            <View style={{ marginBottom: 8 }}>
              <TextInput value={tmpl} onChangeText={setTmpl} multiline style={[s.input, { minHeight: 90, textAlignVertical: "top", paddingTop: 10 }]} maxLength={300} />
              <Text style={s.rowSub}>Use {"{name}"}, {"{amount}"} and {"{month}"} - they are filled in for every student.</Text>
              <Pressable onPress={saveTemplate} style={s.btnLight}><Text style={s.btnLightTxt}>Save message</Text></Pressable>
            </View>
          ) : null}
          {d.items.length === 0 ? <View style={{ alignItems: "center", padding: 26 }}><Ionicons name="checkmark-circle" size={44} color="#16A34A" /><Text style={s.good}>No pending fees. Great!</Text></View> : (
            <>
              <ScrollView style={{ maxHeight: 360 }}>
                {d.items.map((i: any) => (
                  <View key={i.connection_id} style={s.rem}>
                    <Pressable onPress={() => setSel((p) => ({ ...p, [i.connection_id]: !p[i.connection_id] }))} hitSlop={8}>
                      <Ionicons name={sel[i.connection_id] ? "checkbox" : "square-outline"} size={24} color={sel[i.connection_id] ? "#1F6BFF" : "#94A3B8"} />
                    </Pressable>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemName}>{i.name}</Text>
                      <Text style={s.rowSub}>{i.pending_months} month{i.pending_months === 1 ? "" : "s"}{i.overdue ? "  •  overdue" : ""}{i.days_since != null ? `  •  reminded ${i.days_since === 0 ? "today" : i.days_since + "d ago"} (${i.last_channel})` : "  •  not reminded yet"}</Text>
                    </View>
                    <Text style={[s.itemAmt, { color: "#DC2626" }]}>{inr(i.due)}</Text>
                    <Pressable onPress={() => callPhone(i.phone)} hitSlop={6} style={s.mini}><Ionicons name="call" size={15} color="#16A34A" /></Pressable>
                    <Pressable onPress={() => whatsapp(i)} hitSlop={6} style={[s.mini, { backgroundColor: "#DCFCE7" }]} testID={`rem-wa-${i.connection_id}`}><Ionicons name="logo-whatsapp" size={15} color="#16A34A" /></Pressable>
                  </View>
                ))}
              </ScrollView>
              <Pressable onPress={sendApp} disabled={busy || !ids.length} style={[s.btn, (busy || !ids.length) && { opacity: 0.5 }]} testID="rem-send-app">
                {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="notifications" size={17} color="#fff" /><Text style={s.btnTxt}>Remind {ids.length} in the app</Text></>}
              </Pressable>
              <Text style={s.rowSub}>Students reminded in the last {d.settings.min_gap_days} days are skipped, so nobody gets too many messages.</Text>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 6 },
  title: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  sub: { fontSize: 12, color: "#64748B", marginTop: 2 },
  lbl: { color: "#1F6BFF", fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: "#F4F8FF", borderRadius: 12, paddingHorizontal: 12, height: 46, fontSize: 14, color: "#0F172A" },
  wrap: { flexDirection: "row", gap: 8 },
  chip: { paddingHorizontal: 14, height: 38, borderRadius: 999, backgroundColor: "#EEF4FF", alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#1F6BFF" },
  chipTxt: { color: "#1F6BFF", fontWeight: "700", fontSize: 13 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#F8FAFC", borderRadius: 14, padding: 12, marginTop: 8 },
  rowTitle: { fontWeight: "800", color: "#0F172A", fontSize: 14 },
  rowSub: { color: "#64748B", fontSize: 12, marginTop: 3, lineHeight: 17 },
  err: { color: "#B91C1C", fontSize: 13, marginTop: 8, textAlign: "center" },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, backgroundColor: "#1F6BFF", marginTop: 12 },
  btnTxt: { color: "#fff", fontWeight: "800", fontSize: 14.5 },
  btnLight: { alignItems: "center", justifyContent: "center", height: 44, borderRadius: 12, backgroundColor: "#EEF4FF", marginTop: 10 },
  btnLightTxt: { color: "#1F6BFF", fontWeight: "800" },
  item: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#EEF2F7" },
  itemTxt: { color: "#334155", fontSize: 13.5, flex: 1 },
  itemAmt: { color: "#16A34A", fontWeight: "800" },
  itemName: { fontSize: 15, fontWeight: "800", color: "#0F172A" },
  rem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#EEF2F7" },
  mini: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F0FDF4", alignItems: "center", justifyContent: "center" },
  msgBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 8 },
  msgBtnTxt: { color: "#1F6BFF", fontWeight: "800", fontSize: 13 },
  good: { color: "#166534", fontWeight: "700", marginTop: 8 },
});
