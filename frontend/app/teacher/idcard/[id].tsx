import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { idCardHtml } from "@/src/lib/templates";
import { shareHtmlAsPdf, printHtml } from "@/src/lib/pdf";
import { Avatar } from "@/src/components/Avatar";
import { ProUpgradeModal } from "@/src/components/ProUpgradeModal";

export default function IdCard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [card, setCard] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [upgrade, setUpgrade] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCard(await api(`/teacher/students/${id}/idcard`)); }
    catch (e: any) {
      if (String(e?.message || "").includes("Upgrade to Pro")) setUpgrade(true);
    } setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;

  if (upgrade) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
        <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
          <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
          <Text style={styles.hTitle}>ID Card</Text><View style={{ width: 26 }} />
        </View>
        <ProUpgradeModal visible={upgrade} onClose={() => { setUpgrade(false); router.back(); }} feature="Student ID Card Studio" />
      </View>
    );
  }
  if (!card) return null;

  const html = idCardHtml(card);
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(card.qr_payload || "")}`;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Student ID Card</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl, alignItems: "center" }}>
        <View style={styles.card}>
          <LinearGradient colors={["#7C3AED", "#EC4899"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardHead}>
            {card.institute_logo_url ? <Image source={{ uri: card.institute_logo_url }} style={styles.logo} /> : <View style={styles.logo}><Ionicons name="school" size={20} color="#fff" /></View>}
            <Text style={styles.brand}>{(card.institute || "FEEMAT").toUpperCase()}</Text>
            {card.institute_address ? <Text style={styles.subInst}>{card.institute_address}</Text> : null}
          </LinearGradient>
          <View style={styles.cardBody}>
            <View style={styles.photoWrap}>
              <Avatar name={card.student?.name} uri={card.student?.photo_url} size={110} />
            </View>
            <Text style={styles.name} testID="idcard-name">{card.student?.name}</Text>
            <View style={styles.admPill}><Text style={styles.admTxt}>ADM: {card.admission_number}</Text></View>
            <Text style={styles.meta}>{card.class_name || "—"} {card.batch_name ? "• " + card.batch_name : ""}</Text>
            <Text style={styles.meta}>Teacher: {card.teacher_name} ({card.teacher_id})</Text>
            <View style={styles.qrWrap}>
              <Image source={{ uri: qrSrc }} style={{ width: 180, height: 180 }} />
            </View>
          </View>
          <Text style={styles.cardFoot}>Powered by FeeMat</Text>
        </View>

        <View style={styles.actions}>
          <Pressable testID="idcard-download" style={styles.actBtn} onPress={() => shareHtmlAsPdf(html, `${card.admission_number}.pdf`)}>
            <Ionicons name="download" size={20} color="#fff" /><Text style={styles.actTxt}>Download PDF</Text>
          </Pressable>
          <Pressable testID="idcard-print" style={[styles.actBtn, styles.actBtnAlt]} onPress={() => printHtml(html)}>
            <Ionicons name="print" size={20} color={COLORS.brand} /><Text style={[styles.actTxt, { color: COLORS.brand }]}>Print</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  card: { width: 320, borderRadius: 24, overflow: "hidden", backgroundColor: COLORS.surface, shadowColor: COLORS.brand, shadowOpacity: 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  cardHead: { padding: SPACING.lg, alignItems: "center", gap: 6 },
  logo: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  brand: { color: "#fff", fontWeight: "900", fontSize: 20, letterSpacing: 1 },
  subInst: { color: "rgba(255,255,255,0.9)", fontSize: 12 },
  cardBody: { padding: SPACING.lg, alignItems: "center", gap: 6 },
  photoWrap: { marginTop: -60, borderWidth: 4, borderColor: "#fff", borderRadius: 60, overflow: "hidden" },
  name: { fontSize: 20, fontWeight: "900", color: COLORS.onSurface, marginTop: 4 },
  admPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: COLORS.brandSoft },
  admTxt: { color: COLORS.brand, fontWeight: "800", fontSize: 11, letterSpacing: 0.5 },
  meta: { color: COLORS.onSurfaceSecondary, fontSize: 12 },
  qrWrap: { padding: 8, borderWidth: 1, borderColor: COLORS.border, borderRadius: 12, marginTop: SPACING.md },
  cardFoot: { padding: 10, textAlign: "center", color: COLORS.muted, fontSize: 11, backgroundColor: COLORS.surfaceSecondary },
  actions: { flexDirection: "row", gap: SPACING.md, marginTop: SPACING.xl, width: 320 },
  actBtn: { flex: 1, flexDirection: "row", gap: SPACING.sm, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.md },
  actBtnAlt: { backgroundColor: COLORS.brandSoft },
  actTxt: { color: "#fff", fontWeight: "800" },
});
