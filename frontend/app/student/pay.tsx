import React, { useCallback, useState } from "react";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Linking, TextInput, Alert, Share } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GRAD, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";
import { GradientBg, GradBtn } from "@/src/components/ui";

export default function PayScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("");
  const [editing, setEditing] = useState(false);
  const [showPaid, setShowPaid] = useState(false);
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      let cid = id;
      if (!cid) { const h: any = await api("/student/home"); cid = h?.connection?.id; }
      if (cid) {
        const d: any = await api(`/connections/${cid}`);
        setData(d);
        const due = Number(d?.connection?.due_all || 0);
        setAmount((cur) => cur || String(Math.round(due > 0 ? due : d?.connection?.monthly_fee || 0)));
      }
    } catch {}
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const c = data?.connection;
  const t = data?.teacher;
  const amt = parseFloat(amount) || 0;

  const payNow = () => {
    if (!t?.upi_id) { Alert.alert("No UPI ID", "Your teacher has not added a UPI ID yet. Scan the QR code (if shown) or pay your teacher directly."); return; }
    if (!(amt > 0)) { Alert.alert("Enter an amount", "Enter the amount you want to pay."); return; }
    const url = `upi://pay?pa=${t.upi_id}&pn=${encodeURIComponent(t.name)}&am=${amt}&cu=INR&tn=${encodeURIComponent(c.admission_number)}`;
    Linking.openURL(url).catch(() => Alert.alert("No UPI app found", "Install a UPI app (Google Pay, PhonePe, Paytm) or scan the QR code."));
  };

  const copyUpi = () => t?.upi_id && Share.share({ message: t.upi_id });

  const submitPaid = async () => {
    if (!(amt > 0)) { Alert.alert("Enter the amount", "Enter the amount you paid."); return; }
    setBusy(true);
    try {
      await api("/student/payment-claims", { method: "POST", body: { connection_id: c.id, amount: amt, reference: ref.trim(), note: note.trim() } });
      setShowPaid(false); setRef(""); setNote("");
      Alert.alert("Sent to your teacher", "Your teacher will check the payment and confirm it. You will get a notification and a receipt.", [
        { text: "OK", onPress: () => router.replace("/student/payments" as any) },
      ]);
    } catch (e: any) {
      Alert.alert("Could not send", e?.message || "Please try again.");
    } finally { setBusy(false); }
  };

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
      <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={26} color="#fff" /></Pressable>
      <Text style={styles.title}>UPI Payment</Text>
      <View style={{ width: 26 }} />
    </View>
  );

  if (loading) return <GradientBg>{header}<View style={styles.center}><ActivityIndicator color="#35C8FF" /></View></GradientBg>;

  if (!c || !t) {
    return (
      <GradientBg>
        {header}
        <View style={styles.panel}>
          <View style={styles.center}>
            <Ionicons name="school-outline" size={56} color="#1F6BFF" />
            <Text style={styles.name}>No teacher connected</Text>
            <Text style={[styles.meta, { textAlign: "center", paddingHorizontal: 30 }]}>Add your teacher first to pay fees.</Text>
            <GradBtn title="Add Teacher" icon="person-add" onPress={() => router.push("/student/search" as any)} style={{ marginTop: 14, alignSelf: "stretch", marginHorizontal: 30 }} />
          </View>
        </View>
      </GradientBg>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <GradientBg>
        {header}
        <ScrollView style={styles.panel} contentContainerStyle={{ padding: 18, paddingBottom: 40, gap: 14 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.teacherCard}>
            <Avatar name={t.name} uri={t.photo_url} size={56} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{t.name}</Text>
              <Text style={styles.meta} numberOfLines={1}>{t.coaching_name || "—"}</Text>
              <Text style={styles.meta}>ID: {t.teacher_id}</Text>
            </View>
          </View>

          <View style={styles.qrCard}>
            {t.qr_url ? (
              <Image source={{ uri: t.qr_url }} style={styles.qr} contentFit="contain" />
            ) : (
              <View style={[styles.qr, { alignItems: "center", justifyContent: "center", backgroundColor: "#EEF4FF" }]}>
                <Ionicons name="qr-code-outline" size={64} color="#94A3B8" />
                <Text style={[styles.meta, { marginTop: 6 }]}>No QR added</Text>
              </View>
            )}
            <Text style={styles.scan}>Scan & Pay</Text>
          </View>

          <View style={styles.row}>
            <View style={styles.rowIcon}><Ionicons name="at" size={18} color="#1F6BFF" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.k}>UPI ID</Text>
              <Text style={styles.v} selectable>{t.upi_id || "Not added by teacher"}</Text>
            </View>
            {t.upi_id ? <Pressable onPress={copyUpi} hitSlop={10}><Ionicons name="copy-outline" size={20} color="#1F6BFF" /></Pressable> : null}
          </View>

          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: "#DCFCE7" }]}><Text style={{ color: "#16A34A", fontWeight: "800", fontSize: 16 }}>₹</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.k}>Fee Amount</Text>
              {editing ? (
                <TextInput
                  testID="pay-amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" autoFocus
                  onBlur={() => setEditing(false)} style={styles.amtInput}
                />
              ) : (
                <Text style={styles.big}>{inr(amt)}</Text>
              )}
            </View>
            <Pressable onPress={() => setEditing(true)} style={styles.editBtn} hitSlop={8}>
              <Ionicons name="pencil" size={14} color="#1F6BFF" />
              <Text style={styles.editTxt}>Edit</Text>
            </Pressable>
          </View>
          {Number(c.due_all) > 0 ? <Text style={styles.due}>Total pending: {inr(c.due_all)}</Text> : null}

          <View style={styles.orRow}>
            <View style={styles.line} /><Text style={styles.orTxt}>Or pay with any UPI app</Text><View style={styles.line} />
          </View>

          <GradBtn testID="pay-now" title="Pay Now" icon="card" colors={GRAD.green} height={54} onPress={payNow} />
          <Pressable testID="i-have-paid" onPress={() => setShowPaid(true)} style={styles.outline}>
            <Ionicons name="checkmark-circle" size={20} color="#1F6BFF" />
            <Text style={styles.outlineTxt}>I have paid</Text>
          </Pressable>
          <Text style={styles.help}>After paying, tap "I have paid" so your teacher can confirm it and send your receipt.</Text>
          <Pressable onPress={() => router.push("/student/search" as any)} style={styles.outline}>
            <Ionicons name="add-circle" size={20} color="#1F6BFF" />
            <Text style={styles.outlineTxt}>Add Teacher</Text>
          </Pressable>
        </ScrollView>
      </GradientBg>

      <InlineOverlay visible={showPaid} onClose={() => setShowPaid(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowPaid(false)} />
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, paddingBottom: insets.bottom + 18, gap: 8 }}>
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#0F172A" }}>I have paid</Text>
            <Text style={{ color: "#64748B", fontSize: 12, lineHeight: 17 }}>Only send this after the payment is done in your UPI app. Your teacher will check it before confirming.</Text>
            <Text style={styles.k}>Amount paid</Text>
            <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="₹" placeholderTextColor="#94A3B8" style={styles.sheetInput} />
            <Text style={styles.k}>UPI reference / UTR number (recommended)</Text>
            <TextInput value={ref} onChangeText={setRef} autoCapitalize="characters" placeholder="e.g. 412345678901" placeholderTextColor="#94A3B8" style={styles.sheetInput} />
            <Text style={styles.k}>Note (optional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="e.g. October fees" placeholderTextColor="#94A3B8" style={styles.sheetInput} />
            <GradBtn testID="submit-paid" title="Send to teacher" onPress={submitPaid} loading={busy} style={{ marginTop: 10 }} />
          </View>
        </View>
      </InlineOverlay>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 14 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },
  panel: { flex: 1, backgroundColor: "#F4F8FF", borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  teacherCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#DBEAFE", borderRadius: 16, padding: 14 },
  name: { color: "#0F172A", fontSize: 17, fontWeight: "800" },
  meta: { color: "#64748B", fontSize: 12, marginTop: 1 },
  qrCard: { alignItems: "center", backgroundColor: "#fff", borderRadius: 18, padding: 16, gap: 8 },
  qr: { width: 210, height: 210, borderRadius: 12 },
  scan: { color: "#0F172A", fontWeight: "800", fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#fff", borderRadius: 14, padding: 14 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  k: { color: "#64748B", fontSize: 12, fontWeight: "700", marginTop: 4 },
  v: { color: "#0F172A", fontSize: 15, fontWeight: "700", marginTop: 1 },
  big: { color: "#0F172A", fontSize: 24, fontWeight: "800", marginTop: 1 },
  amtInput: { color: "#0F172A", fontSize: 24, fontWeight: "800", padding: 0, marginTop: 1 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: "#E3EEFF" },
  editTxt: { color: "#1F6BFF", fontWeight: "800", fontSize: 12 },
  due: { color: "#DC2626", fontSize: 12, fontWeight: "700", marginTop: -6 },
  orRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  line: { flex: 1, height: 1, backgroundColor: "#DCE6F7" },
  orTxt: { color: "#64748B", fontSize: 12 },
  outline: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: "#1F6BFF", backgroundColor: "#fff" },
  outlineTxt: { color: "#1F6BFF", fontWeight: "800", fontSize: 15 },
  help: { color: "#64748B", fontSize: 12, textAlign: "center", lineHeight: 17 },
  sheetInput: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: "#DCE6F7", paddingHorizontal: 14, fontSize: 16, color: "#0F172A" },
});
