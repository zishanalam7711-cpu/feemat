import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, Linking,
} from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";

export default function StudentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // installment modal
  const [showInst, setShowInst] = useState(false);
  const [instAmt, setInstAmt] = useState("");
  const [instMethod, setInstMethod] = useState("Cash");
  const [instNotes, setInstNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // total fee modal
  const [showFee, setShowFee] = useState(false);
  const [totalFee, setTotalFee] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await api(`/connections/${id}`)); } catch {}
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;

  const c = data.connection;
  const s = data.student;

  const submitInstallment = async () => {
    const amt = parseFloat(instAmt);
    if (!(amt > 0)) return;
    setSaving(true);
    try {
      await api(`/connections/${id}/installments`, { method: "POST", body: { amount: amt, method: instMethod, notes: instNotes } });
      setShowInst(false); setInstAmt(""); setInstNotes("");
      await load();
    } catch {} finally { setSaving(false); }
  };

  const saveFee = async () => {
    const v = parseFloat(totalFee);
    if (!(v >= 0)) return;
    setSaving(true);
    try {
      await api(`/connections/${id}/fee`, { method: "PUT", body: { total_fee: v } });
      setShowFee(false); setTotalFee("");
      await load();
    } catch {} finally { setSaving(false); }
  };

  const markToday = async (status: "present" | "absent" | "late") => {
    const d = new Date().toISOString().slice(0, 10);
    await api(`/connections/${id}/attendance`, { method: "POST", body: { date: d, status } });
    await load();
  };

  const openWhatsapp = () => {
    const msg = `Hi ${s.name},\n\nFee reminder for ${c.admission_number}:\n• Total: ${inr(c.total_fee)}\n• Paid: ${inr(c.paid)}\n• Due: ${inr(c.due)}\n\nPlease clear the pending fee at your earliest.\n— ${data.teacher.name}`;
    const url = `whatsapp://send?phone=${(s.phone || "").replace(/[^0-9]/g, "")}&text=${encodeURIComponent(msg)}`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://wa.me/${(s.phone||"").replace(/[^0-9]/g,"")}?text=${encodeURIComponent(msg)}`));
  };

  const pct = c.total_fee > 0 ? Math.min(100, Math.round((c.paid / c.total_fee) * 100)) : 0;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Student</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
        <View style={styles.card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
            <Avatar name={s.name} uri={s.photo_url} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} testID="student-name">{s.name}</Text>
              <Text style={styles.meta}>Adm: {c.admission_number}</Text>
              <Text style={styles.meta}>Class: {s.class || "—"} • {s.phone || "—"}</Text>
              <Text style={styles.meta}>Father: {s.father_name || "—"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.sect}>Fee Summary</Text>
            <Pressable onPress={() => { setTotalFee(String(c.total_fee || 0)); setShowFee(true); }} testID="edit-total-fee">
              <Text style={{ color: COLORS.brand, fontWeight: "700" }}>Edit Total</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
            <Stat label="Total" value={inr(c.total_fee)} />
            <Stat label="Paid" value={inr(c.paid)} color={COLORS.success} />
            <Stat label="Due" value={inr(c.due)} color={c.due > 0 ? COLORS.error : COLORS.success} />
            <Stat label="Adv" value={inr(c.advance)} />
          </View>
          <View style={styles.progress}>
            <View style={[styles.progressFill, { width: `${pct}%` }]} />
          </View>
          <Text style={styles.pctLbl}>{pct}% collected</Text>
          <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
            <Button testID="add-installment-btn" title="Add Installment" onPress={() => setShowInst(true)} style={{ flex: 1 }} />
            <Button testID="whatsapp-btn" title="WhatsApp" variant="secondary" onPress={openWhatsapp} style={{ flex: 1 }} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Attendance today</Text>
          <View style={{ flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md }}>
            <AttBtn label="Present" testID="att-present" color={COLORS.success} onPress={() => markToday("present")} />
            <AttBtn label="Late" testID="att-late" color={COLORS.warning} onPress={() => markToday("late")} />
            <AttBtn label="Absent" testID="att-absent" color={COLORS.error} onPress={() => markToday("absent")} />
          </View>
          <Text style={[styles.meta, { marginTop: SPACING.md }]}>Attendance so far: {data.attendance_pct}% ({data.attendance.length} records)</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Payment History</Text>
          {data.installments.length === 0 ? (
            <Text style={[styles.meta, { marginTop: SPACING.sm }]}>No installments yet.</Text>
          ) : data.installments.map((i: any) => (
            <View key={i.id} style={styles.instRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.instAmt}>{inr(i.amount)} • {i.method}</Text>
                <Text style={styles.meta}>{new Date(i.date).toLocaleDateString()} {new Date(i.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                {i.notes ? <Text style={styles.meta}>{i.notes}</Text> : null}
              </View>
              <Ionicons name="checkmark-circle" size={20} color={COLORS.success} />
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Installment modal */}
      <Modal transparent visible={showInst} animationType="slide" onRequestClose={() => setShowInst(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Installment</Text>
            <Input testID="inst-amount" label="Amount (₹)" value={instAmt} onChangeText={setInstAmt} keyboardType="decimal-pad" />
            <Input testID="inst-method" label="Method" value={instMethod} onChangeText={setInstMethod} />
            <Input testID="inst-notes" label="Notes (optional)" value={instNotes} onChangeText={setInstNotes} />
            <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
              <Button title="Cancel" variant="secondary" onPress={() => setShowInst(false)} style={{ flex: 1 }} />
              <Button testID="inst-submit" title="Save" onPress={submitInstallment} loading={saving} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Fee modal */}
      <Modal transparent visible={showFee} animationType="fade" onRequestClose={() => setShowFee(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Set Total Fee</Text>
            <Input testID="fee-amount" label="Total Fee (₹)" value={totalFee} onChangeText={setTotalFee} keyboardType="decimal-pad" />
            <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
              <Button title="Cancel" variant="secondary" onPress={() => setShowFee(false)} style={{ flex: 1 }} />
              <Button testID="fee-submit" title="Save" onPress={saveFee} loading={saving} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Stat({ label, value, color }: any) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: COLORS.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: color || COLORS.onSurface, fontWeight: "800", fontSize: 15, marginTop: 2 }}>{value}</Text>
    </View>
  );
}

function AttBtn({ label, color, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.attBtn, { borderColor: color }]}>
      <Text style={{ color, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  card: { margin: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  name: { fontSize: 18, fontWeight: "800", color: COLORS.onSurface },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  sect: { fontSize: 14, fontWeight: "800", color: COLORS.onSurfaceSecondary },
  progress: { height: 8, backgroundColor: COLORS.divider, borderRadius: 999, overflow: "hidden", marginTop: SPACING.md },
  progressFill: { height: 8, backgroundColor: COLORS.brand },
  pctLbl: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  instRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingVertical: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.divider },
  instAmt: { color: COLORS.onSurface, fontWeight: "700" },
  attBtn: { flex: 1, height: 44, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", borderWidth: 1.5, backgroundColor: COLORS.surface },
  modalWrap: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: COLORS.surface, padding: SPACING.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: SPACING.md, paddingBottom: SPACING.xxl },
  modalTitle: { fontSize: 20, fontWeight: "800", color: COLORS.onSurface, marginBottom: SPACING.sm },
});
