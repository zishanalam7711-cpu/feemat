import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, KeyboardAvoidingView, Platform, Linking } from "react-native";
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
  const [classes, setClasses] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);

  // modals
  const [showInst, setShowInst] = useState<any>(null); // month object or "any"
  const [instAmt, setInstAmt] = useState(""); const [instMethod, setInstMethod] = useState("Cash"); const [instNotes, setInstNotes] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [feeInput, setFeeInput] = useState("");
  const [discInput, setDiscInput] = useState("");
  const [classSel, setClassSel] = useState<string | undefined>();
  const [batchSel, setBatchSel] = useState<string | undefined>();
  const [showAdj, setShowAdj] = useState<any>(null);
  const [adjDiscount, setAdjDiscount] = useState(""); const [adjFine, setAdjFine] = useState(""); const [adjWaived, setAdjWaived] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, cls, bat] = await Promise.all([api(`/connections/${id}`), api("/teacher/classes"), api("/teacher/batches")]);
      setData(d as any); setClasses(cls as any); setBatches(bat as any);
      const conn = (d as any).connection;
      setFeeInput(String(conn.monthly_fee || ""));
      setDiscInput(String(conn.discount_pct || ""));
      setClassSel(conn.class_id || undefined);
      setBatchSel(conn.batch_id || undefined);
    } catch {} setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading || !data) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;

  const c = data.connection;
  const s = data.student;
  const pct = c.total_billed > 0 ? Math.min(100, Math.round((c.paid_all / c.total_billed) * 100)) : 0;

  const submitInst = async () => {
    const amt = parseFloat(instAmt);
    if (!(amt > 0)) return;
    setSaving(true);
    try {
      const res: any = await api(`/connections/${id}/installments`, { method: "POST", body: { amount: amt, method: instMethod, notes: instNotes, month: showInst?.month } });
      setShowInst(null); setInstAmt(""); setInstNotes("");
      await load();
      router.push(`/teacher/receipt/${res.receipt.receipt_number}`);
    } catch {} finally { setSaving(false); }
  };

  const saveSetup = async () => {
    setSaving(true);
    try {
      await api(`/connections/${id}/setup`, { method: "PUT", body: {
        monthly_fee: parseFloat(feeInput) || 0,
        discount_pct: parseFloat(discInput) || 0,
        class_id: classSel || null,
        batch_id: batchSel || null,
      } });
      setShowSetup(false);
      await load();
    } catch {} finally { setSaving(false); }
  };

  const saveAdjust = async () => {
    if (!showAdj) return;
    setSaving(true);
    try {
      await api(`/fee-months/${showAdj.id}/adjust`, { method: "PUT", body: {
        discount: adjDiscount === "" ? undefined : parseFloat(adjDiscount),
        fine: adjFine === "" ? undefined : parseFloat(adjFine),
        waived: adjWaived,
      } });
      setShowAdj(null);
      await load();
    } catch {} finally { setSaving(false); }
  };

  const markAtt = async (status: "present" | "absent" | "late" | "leave") => {
    const d = new Date().toISOString().slice(0, 10);
    await api(`/connections/${id}/attendance`, { method: "POST", body: { date: d, status } });
    await load();
  };

  const openWhatsapp = (month?: any) => {
    const dueAmt = month ? month.due : c.due_all;
    const monthTxt = month ? ` for ${month.month}` : "";
    const msg = `Hi ${s.name},\n\nFee reminder${monthTxt}:\n• Total Due: ${inr(dueAmt)}\n• Admission: ${c.admission_number}\n\nPlease clear at your earliest convenience.\n— ${data.teacher.name}`;
    const url = `whatsapp://send?phone=${(s.phone || "").replace(/[^0-9]/g, "")}&text=${encodeURIComponent(msg)}`;
    Linking.openURL(url).catch(() => Linking.openURL(`https://wa.me/${(s.phone||"").replace(/[^0-9]/g,"")}?text=${encodeURIComponent(msg)}`));
  };

  const deactivate = async () => {
    await api(`/connections/${id}/deactivate`, { method: "POST" });
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Student</Text>
        <Pressable testID="setup-btn" onPress={() => setShowSetup(true)} hitSlop={12}><Ionicons name="settings" size={22} color={COLORS.brand} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: SPACING.xxl }}>
        <View style={styles.card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md }}>
            <Avatar name={s.name} uri={s.photo_url} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} testID="student-name">{s.name}</Text>
              <Text style={styles.meta}>Adm: {c.admission_number}{c.active === false ? " • INACTIVE" : ""}</Text>
              <Text style={styles.meta}>{data.class_name || "—"} • {data.batch_name || "—"} • {s.phone || "—"}</Text>
              <Text style={styles.meta}>Father: {s.father_name || "—"}</Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md }}>
            <Text style={styles.pill}>Monthly {inr(c.monthly_fee)}</Text>
            {c.discount_pct > 0 && <Text style={styles.pill}>{c.discount_pct}% off</Text>}
          </View>
        </View>

        <View style={styles.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.sect}>Fee Summary</Text>
            <Pressable onPress={() => openWhatsapp()} testID="whatsapp-all">
              <Ionicons name="logo-whatsapp" size={22} color={COLORS.success} />
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
            <Stat label="Billed" value={inr(c.total_billed)} />
            <Stat label="Paid" value={inr(c.paid_all)} color={COLORS.success} />
            <Stat label="Due" value={inr(c.due_all)} color={c.due_all > 0 ? COLORS.error : COLORS.success} />
            <Stat label="Adv" value={inr(c.advance)} />
          </View>
          <View style={styles.progress}><View style={[styles.progressFill, { width: `${pct}%` }]} /></View>
          <Text style={styles.pctLbl}>{pct}% collected</Text>
          <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
            <Button testID="add-installment-btn" title="Add Installment" onPress={() => setShowInst({ month: null })} style={{ flex: 1 }} />
            <Button testID="wa-btn" title="Reminder" variant="secondary" onPress={() => openWhatsapp()} style={{ flex: 1 }} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Monthly Fees</Text>
          {data.fee_months.length === 0 ? (
            <Text style={{ color: COLORS.muted, marginTop: SPACING.sm }}>Set a monthly fee to auto-generate monthly records.</Text>
          ) : data.fee_months.slice().reverse().map((fm: any) => (
            <View key={fm.id} style={styles.monthRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.monthLbl}>{fm.month}</Text>
                  <StatusChip status={fm.status} />
                </View>
                <Text style={styles.meta}>{inr(fm.original_fee)}{fm.discount > 0 ? ` − ${inr(fm.discount)}` : ""}{fm.fine > 0 ? ` + ${inr(fm.fine)} fine` : ""}{fm.waived ? " • Waived" : ""}</Text>
                <Text style={styles.meta}>Paid {inr(fm.paid)} • Due {inr(fm.due)}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: SPACING.sm }}>
                <Pressable onPress={() => { setShowAdj(fm); setAdjDiscount(String(fm.discount || "")); setAdjFine(String(fm.fine || "")); setAdjWaived(!!fm.waived); }} hitSlop={8} testID={`adjust-${fm.month}`}>
                  <Ionicons name="options" size={20} color={COLORS.muted} />
                </Pressable>
                {!fm.waived && fm.due > 0 && (
                  <Pressable testID={`inst-month-${fm.month}`} onPress={() => { setShowInst(fm); setInstAmt(String(fm.due)); }} hitSlop={8}>
                    <Ionicons name="add-circle" size={22} color={COLORS.brand} />
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Today's Attendance</Text>
          <View style={{ flexDirection: "row", gap: 6, marginTop: SPACING.md }}>
            <AttBtn label="Present" testID="att-present" color={COLORS.success} onPress={() => markAtt("present")} />
            <AttBtn label="Late" testID="att-late" color={COLORS.warning} onPress={() => markAtt("late")} />
            <AttBtn label="Absent" testID="att-absent" color={COLORS.error} onPress={() => markAtt("absent")} />
            <AttBtn label="Leave" testID="att-leave" color={COLORS.info} onPress={() => markAtt("leave")} />
          </View>
          <Text style={[styles.meta, { marginTop: SPACING.md }]}>{data.attendance_pct}% attendance • {data.attendance.length} sessions</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sect}>Payment History</Text>
          {data.installments.length === 0 ? (
            <Text style={{ color: COLORS.muted, marginTop: SPACING.sm }}>No installments yet.</Text>
          ) : data.installments.map((i: any) => (
            <Pressable key={i.id} style={styles.instRow} onPress={() => router.push(`/teacher/receipt/${i.receipt_number}`)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.instAmt}>{inr(i.amount)} • {i.method}</Text>
                <Text style={styles.meta}>{i.month} • {new Date(i.date).toLocaleString()}</Text>
                {i.notes ? <Text style={styles.meta}>{i.notes}</Text> : null}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: COLORS.brand, fontSize: 11, fontWeight: "700" }}>{i.receipt_number}</Text>
                <Ionicons name="receipt" size={18} color={COLORS.brand} />
              </View>
            </Pressable>
          ))}
        </View>

        <View style={{ padding: SPACING.md }}>
          <Button title={c.active === false ? "Student Deactivated" : "Deactivate Student"} variant="secondary" onPress={deactivate} disabled={c.active === false} testID="deactivate-btn" />
        </View>
      </ScrollView>

      {/* Setup Modal */}
      <Modal transparent visible={showSetup} animationType="slide" onRequestClose={() => setShowSetup(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Fee Setup</Text>
            <Input testID="setup-fee" label="Monthly Fee (₹)" value={feeInput} onChangeText={setFeeInput} keyboardType="decimal-pad" />
            <Input testID="setup-disc" label="Default Discount %" value={discInput} onChangeText={setDiscInput} keyboardType="decimal-pad" />
            <View>
              <Text style={styles.lbl}>Class</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                <Pressable style={[styles.chip, !classSel && styles.chipOn]} onPress={() => setClassSel(undefined)}><Text style={[styles.chipTxt, !classSel && styles.chipTxtOn]}>None</Text></Pressable>
                {classes.map((c: any) => (
                  <Pressable key={c.id} testID={`cls-${c.id}`} style={[styles.chip, classSel === c.id && styles.chipOn]} onPress={() => setClassSel(c.id)}>
                    <Text style={[styles.chipTxt, classSel === c.id && styles.chipTxtOn]}>{c.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View>
              <Text style={styles.lbl}>Batch</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                <Pressable style={[styles.chip, !batchSel && styles.chipOn]} onPress={() => setBatchSel(undefined)}><Text style={[styles.chipTxt, !batchSel && styles.chipTxtOn]}>None</Text></Pressable>
                {batches.map((b: any) => (
                  <Pressable key={b.id} style={[styles.chip, batchSel === b.id && styles.chipOn]} onPress={() => setBatchSel(b.id)}>
                    <Text style={[styles.chipTxt, batchSel === b.id && styles.chipTxtOn]}>{b.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
              <Button title="Cancel" variant="secondary" onPress={() => setShowSetup(false)} style={{ flex: 1 }} />
              <Button testID="setup-save" title="Save" onPress={saveSetup} loading={saving} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Installment Modal */}
      <Modal transparent visible={!!showInst} animationType="slide" onRequestClose={() => setShowInst(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Installment{showInst?.month ? ` — ${showInst.month}` : ""}</Text>
            <Input testID="inst-amount" label="Amount (₹)" value={instAmt} onChangeText={setInstAmt} keyboardType="decimal-pad" />
            <Input testID="inst-method" label="Method" value={instMethod} onChangeText={setInstMethod} />
            <Input testID="inst-notes" label="Notes (optional)" value={instNotes} onChangeText={setInstNotes} />
            <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
              <Button title="Cancel" variant="secondary" onPress={() => setShowInst(null)} style={{ flex: 1 }} />
              <Button testID="inst-submit" title="Save & Receipt" onPress={submitInst} loading={saving} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Adjust Modal */}
      <Modal transparent visible={!!showAdj} animationType="fade" onRequestClose={() => setShowAdj(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Adjust {showAdj?.month}</Text>
            <Input testID="adj-disc" label="Discount (₹)" value={adjDiscount} onChangeText={setAdjDiscount} keyboardType="decimal-pad" />
            <Input testID="adj-fine" label="Fine (₹)" value={adjFine} onChangeText={setAdjFine} keyboardType="decimal-pad" />
            <Pressable onPress={() => setAdjWaived(!adjWaived)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name={adjWaived ? "checkbox" : "square-outline"} size={22} color={COLORS.brand} />
              <Text>Waive this month</Text>
            </Pressable>
            <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
              <Button title="Cancel" variant="secondary" onPress={() => setShowAdj(null)} style={{ flex: 1 }} />
              <Button testID="adj-save" title="Save" onPress={saveAdjust} loading={saving} style={{ flex: 1 }} />
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
      <Text style={{ color, fontWeight: "700", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}
function StatusChip({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    paid: { bg: "#DCFCE7", fg: "#065F46", label: "PAID" },
    partial: { bg: "#FEF3C7", fg: "#92400E", label: "PARTIAL" },
    due: { bg: "#DBEAFE", fg: "#1E40AF", label: "DUE" },
    overdue: { bg: "#FEE2E2", fg: "#991B1B", label: "OVERDUE" },
    waived: { bg: "#E0E7FF", fg: "#3730A3", label: "WAIVED" },
  };
  const s = map[status] || map.due;
  return <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: s.bg }}><Text style={{ color: s.fg, fontSize: 9, fontWeight: "800" }}>{s.label}</Text></View>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  card: { margin: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  name: { fontSize: 18, fontWeight: "800", color: COLORS.onSurface },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  sect: { fontSize: 14, fontWeight: "800", color: COLORS.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.5 },
  progress: { height: 8, backgroundColor: COLORS.divider, borderRadius: 999, overflow: "hidden", marginTop: SPACING.md },
  progressFill: { height: 8, backgroundColor: COLORS.brand },
  pctLbl: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  monthRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingVertical: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.divider },
  monthLbl: { color: COLORS.onSurface, fontWeight: "800", fontSize: 15 },
  instRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingVertical: SPACING.md, borderTopWidth: 1, borderTopColor: COLORS.divider },
  instAmt: { color: COLORS.onSurface, fontWeight: "700" },
  attBtn: { flex: 1, paddingVertical: 10, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", borderWidth: 1.5, backgroundColor: COLORS.surface },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: COLORS.brandSoft, color: COLORS.brand, fontWeight: "700", fontSize: 12 },
  modalWrap: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: COLORS.surface, padding: SPACING.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: SPACING.md, paddingBottom: SPACING.xxl },
  modalTitle: { fontSize: 20, fontWeight: "800", color: COLORS.onSurface, marginBottom: SPACING.sm },
  lbl: { color: COLORS.onSurfaceSecondary, fontSize: 13, fontWeight: "600", marginBottom: 4 },
  chip: { paddingHorizontal: 12, height: 32, borderRadius: 999, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border },
  chipOn: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipTxt: { color: COLORS.onSurfaceSecondary, fontWeight: "600", fontSize: 12 },
  chipTxtOn: { color: "#fff" },
});
