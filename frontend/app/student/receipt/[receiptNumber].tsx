import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { receiptHtml } from "@/src/lib/templates";
import { shareHtmlAsPdf, printHtml } from "@/src/lib/pdf";

export default function StudentReceipt() {
  const { receiptNumber } = useLocalSearchParams<{ receiptNumber: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [r, setR] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => { setLoading(true); try { setR(await api(`/receipts/${receiptNumber}`)); } catch {} setLoading(false); }, [receiptNumber]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (loading || !r) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;
  const html = receiptHtml(r);
  const share = async () => {
    const msg = `FEEMAT RECEIPT\nReceipt #: ${r.receipt_number}\nAmount: ${inr(r.amount)}\nMonth: ${r.month}\nStudent: ${r.student_name}\nAdmission: ${r.admission_number}`;
    await Share.share({ message: msg });
  };
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Receipt</Text>
        <Pressable onPress={share} hitSlop={12}><Ionicons name="share-outline" size={22} color={COLORS.brand} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl }}>
        <View style={styles.receipt}>
          <View style={styles.brandBar}><Text style={styles.brand}>FEEMAT</Text><Text style={styles.badge}>PAID</Text></View>
          <Text style={styles.institute}>{r.institute || "Independent Teacher"}</Text>
          <View style={styles.line} />
          <Row k="Receipt #" v={r.receipt_number} big />
          <Row k="Date" v={new Date(r.date).toLocaleString()} />
          <Row k="Student" v={r.student_name} />
          <Row k="Admission" v={r.admission_number} />
          <Row k="Fee Month" v={r.month} />
          <Row k="Method" v={r.method} />
          <View style={styles.line} />
          <View style={styles.total}><Text style={styles.totalLbl}>Amount Paid</Text><Text style={styles.totalVal}>{inr(r.amount)}</Text></View>
        </View>
        <View style={styles.actions}>
          <Pressable testID="receipt-download" style={styles.actBtn} onPress={() => shareHtmlAsPdf(html, `${r.receipt_number}.pdf`)}><Ionicons name="download" size={20} color="#fff" /><Text style={styles.actTxt}>Download PDF</Text></Pressable>
          <Pressable testID="receipt-print" style={[styles.actBtn, styles.actBtnAlt]} onPress={() => printHtml(html)}><Ionicons name="print" size={20} color={COLORS.brand} /><Text style={[styles.actTxt, { color: COLORS.brand }]}>Print</Text></Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
function Row({ k, v, big }: any) { return (<View style={styles.kv}><Text style={styles.k}>{k}</Text><Text style={[styles.v, big && { fontSize: 15, fontWeight: "800" }]}>{v}</Text></View>); }
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  receipt: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, padding: SPACING.xl, borderWidth: 1, borderColor: COLORS.divider, gap: 4 },
  brandBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  brand: { fontSize: 26, fontWeight: "900", color: COLORS.brand, letterSpacing: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: COLORS.success, color: "#fff", fontWeight: "800", fontSize: 11 },
  institute: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.sm },
  line: { height: 1, backgroundColor: COLORS.divider, marginVertical: SPACING.md },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, gap: SPACING.md },
  k: { color: COLORS.muted, fontSize: 12 },
  v: { color: COLORS.onSurface, fontSize: 13, fontWeight: "600", flex: 1, textAlign: "right" },
  total: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: SPACING.md },
  totalLbl: { color: COLORS.muted, fontSize: 14 },
  totalVal: { color: COLORS.brand, fontSize: 28, fontWeight: "900" },
  actions: { flexDirection: "row", gap: SPACING.md, marginTop: SPACING.lg },
  actBtn: { flex: 1, flexDirection: "row", gap: SPACING.sm, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.md },
  actBtnAlt: { backgroundColor: COLORS.brandSoft },
  actTxt: { color: "#fff", fontWeight: "800" },
});
