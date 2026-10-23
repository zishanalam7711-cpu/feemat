import React, { useCallback, useMemo, useState } from "react";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import {
  View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Linking, Share, RefreshControl,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

const DARK = {
  bg: "#071B45",
  card: "#0E2A63",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  input: "rgba(255,255,255,0.07)",
};

type Tab = "confirm" | "qr" | "request";
const REASONS = ["Money not received", "Wrong amount", "Wrong reference number"];

const waNumber = (p?: string) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length === 10 ? "91" + d : d;
};
const statusColor = (s: string) => (s === "confirmed" ? "#10B981" : s === "rejected" ? "#EF4444" : "#F59E0B");

export default function TeacherUpi() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("confirm");
  const [profile, setProfile] = useState<any>(null);
  const [claims, setClaims] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [sheet, setSheet] = useState<{ mode: "confirm" | "reject"; claim: any } | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c, s]: any = await Promise.all([
        api("/teacher/profile").catch(() => null),
        api("/teacher/payment-claims?status=all"),
        api("/teacher/students?filter=due&limit=200").catch(() => ({ items: [] })),
      ]);
      setProfile(p); setClaims(c || []); setStudents(s.items || []);
    } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const pending = useMemo(() => claims.filter((c) => c.status === "pending"), [claims]);
  const history = useMemo(() => claims.filter((c) => c.status !== "pending").slice(0, 20), [claims]);
  const shown = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return students.filter((s) => !qq || (s.student?.name || "").toLowerCase().includes(qq) || String(s.admission_number || "").toLowerCase().includes(qq));
  }, [students, q]);

  const openConfirm = (c: any) => { setAmount(String(Math.round(c.amount))); setSheet({ mode: "confirm", claim: c }); };
  const openReject = (c: any) => { setReason(""); setSheet({ mode: "reject", claim: c }); };

  const confirm = async () => {
    if (!sheet) return;
    const amt = parseFloat(amount);
    if (!(amt > 0)) { Alert.alert("Enter an amount", "Enter the amount you received."); return; }
    setBusy(true);
    try {
      const res: any = await api(`/teacher/payment-claims/${sheet.claim.id}/confirm`, { method: "POST", body: { amount: amt } });
      setSheet(null);
      await load();
      const rn = res?.receipt?.receipt_number;
      Alert.alert("Payment confirmed", `Receipt ${rn || ""} has been created and the student was notified.`, [
        { text: "Close" },
        ...(rn ? [{ text: "View receipt", onPress: () => router.push(`/teacher/receipt/${rn}` as any) }] : []),
      ]);
    } catch (e: any) {
      Alert.alert("Could not confirm", e?.message || "Please try again.");
    } finally { setBusy(false); }
  };

  const reject = async () => {
    if (!sheet) return;
    setBusy(true);
    try {
      await api(`/teacher/payment-claims/${sheet.claim.id}/reject`, { method: "POST", body: { reason: reason.trim() } });
      setSheet(null);
      await load();
    } catch (e: any) {
      Alert.alert("Could not reject", e?.message || "Please try again.");
    } finally { setBusy(false); }
  };

  const shareUpi = async () => {
    if (!profile?.upi_id) return;
    await Share.share({ message: `Pay fees to UPI ID: ${profile.upi_id}${profile.name ? ` (${profile.name})` : ""}` });
  };

  const askPayment = (s: any) => {
    if (!profile?.upi_id) { Alert.alert("Add your UPI ID first", "Open Profile and add your UPI ID and QR code."); return; }
    const text =
      `Hello ${s.student?.name || ""}, your fees of ${inr(s.due)} are pending.\n` +
      `Pay by UPI to: ${profile.upi_id}${profile.name ? ` (${profile.name})` : ""}\n\n` +
      `After paying, open the FeeMat app, go to Fees and tap "I have paid" with your reference number. Thank you.`;
    const num = waNumber(s.student?.phone);
    if (num) Linking.openURL(`https://wa.me/${num}?text=${encodeURIComponent(text)}`).catch(() => Share.share({ message: text }));
    else Share.share({ message: text });
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
      <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
      <Text style={styles.title}>UPI Pay</Text>
    </View>
  );

  if (loading) return <View style={[styles.center, { backgroundColor: DARK.bg }]}><ActivityIndicator color="#35A7FF" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      {header}
      <View style={styles.tabs}>
        {([["confirm", `Confirm${pending.length ? ` (${pending.length})` : ""}`], ["qr", "My QR"], ["request", "Ask to pay"]] as [Tab, string][]).map(([k, l]) => (
          <Pressable key={k} onPress={() => setTab(k)} style={[styles.tabBtn, tab === k && styles.tabOn]}>
            <Text style={[styles.tabTxt, tab === k && { color: "#fff" }]}>{l}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#35A7FF" />}
        keyboardShouldPersistTaps="handled"
      >
        {/* ---------------- confirm ---------------- */}
        {tab === "confirm" && (
          <>
            <View style={styles.info}>
              <Ionicons name="shield-checkmark" size={18} color="#35A7FF" />
              <Text style={styles.infoTxt}>When a student says "I have paid", it shows up here. Check your UPI app first, and only confirm if the money has arrived. Confirming creates the receipt.</Text>
            </View>

            {pending.length === 0 ? (
              <View style={[styles.center, { paddingVertical: 40 }]}>
                <Ionicons name="checkmark-circle-outline" size={56} color="rgba(255,255,255,0.25)" />
                <Text style={{ color: DARK.sub, marginTop: 8 }}>No payments waiting for confirmation.</Text>
              </View>
            ) : pending.map((c) => (
              <View key={c.id} style={styles.card}>
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{c.student_name || "Student"}</Text>
                    <Text style={styles.meta}>{c.admission_number} • {new Date(c.created_at).toLocaleString()}</Text>
                  </View>
                  <Text style={styles.amt}>{inr(c.amount)}</Text>
                </View>
                {c.reference ? <Text style={styles.ref}>Reference: {c.reference}</Text> : <Text style={styles.metaWarn}>No reference number given</Text>}
                {c.note ? <Text style={styles.meta}>Note: {c.note}</Text> : null}
                <View style={{ flexDirection: "row", gap: SPACING.sm, marginTop: SPACING.md }}>
                  <Pressable onPress={() => openConfirm(c)} style={[styles.action, { backgroundColor: "#10B981" }]}>
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={styles.actionTxt}>Confirm</Text>
                  </Pressable>
                  <Pressable onPress={() => openReject(c)} style={[styles.action, { backgroundColor: "rgba(239,68,68,0.15)" }]}>
                    <Ionicons name="close" size={16} color="#F87171" />
                    <Text style={[styles.actionTxt, { color: "#F87171" }]}>Reject</Text>
                  </Pressable>
                </View>
              </View>
            ))}

            {history.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.sect}>Recent</Text>
                {history.map((c) => (
                  <View key={c.id} style={styles.histRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{c.student_name || "Student"}</Text>
                      <Text style={styles.meta}>{inr(c.confirmed_amount ?? c.amount)}{c.reference ? ` • ${c.reference}` : ""}</Text>
                    </View>
                    <View style={[styles.pill, { backgroundColor: statusColor(c.status) + "26" }]}>
                      <Text style={[styles.pillTxt, { color: statusColor(c.status) }]}>{c.status === "confirmed" ? "Confirmed" : "Rejected"}</Text>
                    </View>
                    {c.receipt_number ? (
                      <Pressable onPress={() => router.push(`/teacher/receipt/${c.receipt_number}` as any)} hitSlop={8}>
                        <Ionicons name="receipt" size={18} color="#35A7FF" />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* ---------------- my qr ---------------- */}
        {tab === "qr" && (
          <>
            {profile?.upi_id || profile?.qr_url ? (
              <View style={[styles.card, { alignItems: "center" }]}>
                <Text style={styles.sect}>Your payment details</Text>
                {profile?.qr_url ? (
                  <Image source={{ uri: profile.qr_url }} style={styles.qr} contentFit="contain" />
                ) : (
                  <View style={[styles.qr, styles.qrEmpty]}><Ionicons name="qr-code-outline" size={56} color="rgba(255,255,255,0.3)" /></View>
                )}
                {profile?.upi_id ? <Text style={styles.upiId} selectable>{profile.upi_id}</Text> : <Text style={styles.metaWarn}>No UPI ID added</Text>}
                {profile?.upi_id ? (
                  <Pressable onPress={shareUpi} style={[styles.action, { backgroundColor: "rgba(53,167,255,0.18)", alignSelf: "stretch", marginTop: SPACING.md }]}>
                    <Ionicons name="share-social" size={16} color="#35A7FF" />
                    <Text style={[styles.actionTxt, { color: "#35A7FF" }]}>Share UPI ID</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={[styles.card, { alignItems: "center", gap: SPACING.md }]}>
                <Ionicons name="qr-code-outline" size={56} color="rgba(255,255,255,0.3)" />
                <Text style={styles.name}>No UPI details yet</Text>
                <Text style={[styles.meta, { textAlign: "center" }]}>Add your UPI ID and QR code so students can pay you from the app.</Text>
              </View>
            )}
            <Pressable onPress={() => router.push("/teacher/profile" as any)} style={[styles.action, { backgroundColor: "#1F6BFF" }]}>
              <Ionicons name="create" size={16} color="#fff" />
              <Text style={styles.actionTxt}>{profile?.upi_id || profile?.qr_url ? "Change in Profile" : "Add in Profile"}</Text>
            </Pressable>
            <View style={styles.card}>
              <Text style={styles.sect}>How it works</Text>
              <Text style={styles.step}>1. The student opens Fees in the app and pays you by UPI (QR or UPI ID).</Text>
              <Text style={styles.step}>2. They tap "I have paid" and enter the amount and reference number.</Text>
              <Text style={styles.step}>3. You see it under Confirm. Check your UPI app, then confirm to create the receipt.</Text>
            </View>
          </>
        )}

        {/* ---------------- request ---------------- */}
        {tab === "request" && (
          <>
            <TextInput
              value={q} onChangeText={setQ} placeholder="Search students with pending fees"
              placeholderTextColor="rgba(255,255,255,0.35)" style={styles.search}
            />
            {shown.length === 0 ? (
              <View style={[styles.center, { paddingVertical: 40 }]}>
                <Ionicons name="happy-outline" size={56} color="rgba(255,255,255,0.25)" />
                <Text style={{ color: DARK.sub, marginTop: 8 }}>No students with pending fees.</Text>
              </View>
            ) : shown.map((s) => (
              <View key={s.id} style={[styles.card, styles.rowBetween]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{s.student?.name || "Student"}</Text>
                  <Text style={styles.meta}>{s.admission_number}</Text>
                </View>
                <Text style={[styles.amt, { color: "#F87171", marginRight: SPACING.sm }]}>{inr(s.due)}</Text>
                <Pressable onPress={() => askPayment(s)} style={styles.waBtn}>
                  <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                </Pressable>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <InlineOverlay visible={!!sheet} onClose={() => setSheet(null)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setSheet(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.lg }]}>
            {sheet?.mode === "confirm" ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.sheetTitle}>Confirm payment</Text>
                <Text style={styles.meta}>{sheet.claim.student_name} • {sheet.claim.admission_number}</Text>
                {sheet.claim.reference ? <Text style={styles.ref}>Reference: {sheet.claim.reference}</Text> : null}
                <View style={styles.warn}>
                  <Ionicons name="warning" size={16} color="#F59E0B" />
                  <Text style={styles.warnTxt}>Check your UPI app first. Only confirm if this money has really arrived.</Text>
                </View>
                <Text style={styles.label}>Amount received</Text>
                <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input} />
                <Text style={styles.hint}>The student said {inr(sheet.claim.amount)}. Change it if you received a different amount.</Text>
                <Pressable onPress={confirm} disabled={busy} style={[styles.saveBtn, { backgroundColor: "#10B981" }, busy && { opacity: 0.6 }]}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Confirm & create receipt</Text>}
                </Pressable>
              </ScrollView>
            ) : sheet?.mode === "reject" ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={styles.sheetTitle}>Reject payment</Text>
                <Text style={styles.meta}>{sheet.claim.student_name} said {inr(sheet.claim.amount)}</Text>
                <Text style={styles.label}>Reason (the student will see this)</Text>
                <View style={styles.wrap}>
                  {REASONS.map((r) => (
                    <Pressable key={r} onPress={() => setReason(r)} style={[styles.chip, reason === r && styles.chipOn]}>
                      <Text style={[styles.chipTxt, reason === r && { color: "#fff" }]}>{r}</Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput value={reason} onChangeText={setReason} placeholder="Or type a reason" placeholderTextColor="rgba(255,255,255,0.35)" style={[styles.input, { marginTop: SPACING.md }]} />
                <Pressable onPress={reject} disabled={busy} style={[styles.saveBtn, { backgroundColor: "#EF4444" }, busy && { opacity: 0.6 }]}>
                  {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Reject payment</Text>}
                </Pressable>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </InlineOverlay>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  tabs: { flexDirection: "row", marginHorizontal: SPACING.md, backgroundColor: DARK.input, borderRadius: 12, padding: 3 },
  tabBtn: { flex: 1, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: "#1F6BFF" },
  tabTxt: { color: DARK.sub, fontWeight: "700", fontSize: 12 },
  info: { flexDirection: "row", gap: 8, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: "rgba(53,167,255,0.12)", borderWidth: 1, borderColor: "rgba(53,167,255,0.3)" },
  infoTxt: { flex: 1, color: "rgba(255,255,255,0.85)", fontSize: 12, lineHeight: 17 },
  card: { padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border, gap: 6 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  name: { color: "#fff", fontWeight: "700", fontSize: 15 },
  meta: { color: DARK.sub, fontSize: 12, marginTop: 2 },
  metaWarn: { color: "#F59E0B", fontSize: 12 },
  ref: { color: "#9CC3FF", fontSize: 13, fontWeight: "700" },
  amt: { color: "#fff", fontWeight: "800", fontSize: 18 },
  action: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: 12 },
  actionTxt: { color: "#fff", fontWeight: "700", fontSize: 13 },
  sect: { color: DARK.sub, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  histRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: DARK.border, marginTop: 6 },
  pill: { paddingHorizontal: 10, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  pillTxt: { fontSize: 11, fontWeight: "800" },
  qr: { width: 230, height: 230, borderRadius: 14, backgroundColor: "#fff", marginVertical: SPACING.md },
  qrEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: DARK.input },
  upiId: { color: "#FBBF24", fontSize: 18, fontWeight: "800", letterSpacing: 0.5 },
  step: { color: "rgba(255,255,255,0.8)", fontSize: 13, lineHeight: 19, marginTop: 6 },
  search: { height: 44, borderRadius: 12, backgroundColor: DARK.input, color: "#fff", paddingHorizontal: 14, fontSize: 14 },
  waBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: "rgba(37,211,102,0.12)", alignItems: "center", justifyContent: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, maxHeight: "90%" },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  warn: { flexDirection: "row", gap: 8, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: "rgba(245,158,11,0.12)", marginTop: SPACING.md },
  warnTxt: { flex: 1, color: "#FBBF24", fontSize: 12, lineHeight: 17 },
  label: { color: DARK.sub, fontSize: 12, fontWeight: "700", marginTop: SPACING.md, marginBottom: 6, textTransform: "uppercase" },
  input: { height: 48, borderRadius: RADIUS.md, backgroundColor: DARK.input, color: "#fff", paddingHorizontal: SPACING.md, fontSize: 16, borderWidth: 1, borderColor: DARK.border },
  hint: { color: DARK.sub, fontSize: 11, marginTop: 8, lineHeight: 16 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: { paddingHorizontal: 12, height: 34, borderRadius: 999, backgroundColor: DARK.input, borderWidth: 1, borderColor: DARK.border, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: "#1F6BFF", borderColor: "#1F6BFF" },
  chipTxt: { color: DARK.sub, fontSize: 13, fontWeight: "600" },
  saveBtn: { height: 50, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", marginTop: SPACING.xl },
  saveTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
