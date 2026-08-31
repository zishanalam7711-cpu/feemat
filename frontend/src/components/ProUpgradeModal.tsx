import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { COLORS, SPACING, RADIUS, inr } from "@/src/lib/theme";

export function ProUpgradeModal({ visible, onClose, feature }: { visible: boolean; onClose: () => void; feature?: string }) {
  const router = useRouter();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.card}>
          <LinearGradient colors={["#7C3AED", "#EC4899"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.head}>
            <Ionicons name="rocket" size={40} color="#fff" />
            <Text style={styles.title}>Upgrade to FeeMat Pro</Text>
            <Text style={styles.sub}>{feature ? `“${feature}” is a Pro feature.` : "Unlock the full FeeMat experience."}</Text>
          </LinearGradient>
          <View style={styles.body}>
            <Row icon="checkmark-circle" text="Unlimited active students" />
            <Row icon="checkmark-circle" text="Homework, Exams & Results" />
            <Row icon="checkmark-circle" text="Reports, Analytics & PDF receipts" />
            <Row icon="checkmark-circle" text="Student ID Card Studio" />
            <View style={styles.priceRow}>
              <View style={styles.pricePill}><Text style={styles.priceTxt}>{inr(299)}/mo</Text></View>
              <View style={[styles.pricePill, styles.pricePillBest]}>
                <Text style={styles.priceTxtBest}>{inr(2999)}/yr</Text>
                <Text style={styles.save}>Save {inr(589)}</Text>
              </View>
            </View>
            <Pressable testID="upgrade-cta" style={styles.cta} onPress={() => { onClose(); router.push("/teacher/subscription"); }}>
              <Text style={{ color: "#fff", fontWeight: "800" }}>See Plans</Text>
            </Pressable>
            <Pressable onPress={onClose} style={{ padding: SPACING.md, alignItems: "center" }}>
              <Text style={{ color: COLORS.muted }}>Maybe later</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
function Row({ icon, text }: any) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={16} color={COLORS.brand} />
      <Text style={styles.rowTxt}>{text}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "rgba(15,23,42,0.6)", justifyContent: "center", padding: SPACING.lg },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.lg, overflow: "hidden" },
  head: { padding: SPACING.xl, alignItems: "center", gap: 8 },
  title: { color: "#fff", fontSize: 22, fontWeight: "900" },
  sub: { color: "rgba(255,255,255,0.9)", fontSize: 13, textAlign: "center" },
  body: { padding: SPACING.lg, gap: SPACING.sm },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, paddingVertical: 4 },
  rowTxt: { color: COLORS.onSurface, fontSize: 14 },
  priceRow: { flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md },
  pricePill: { flex: 1, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", borderWidth: 1, borderColor: COLORS.border },
  pricePillBest: { backgroundColor: COLORS.brandSoft, borderColor: COLORS.brand },
  priceTxt: { color: COLORS.onSurface, fontWeight: "800" },
  priceTxtBest: { color: COLORS.brand, fontWeight: "900" },
  save: { color: COLORS.brand, fontSize: 11, fontWeight: "700", marginTop: 2 },
  cta: { backgroundColor: COLORS.brand, paddingVertical: 14, borderRadius: RADIUS.md, alignItems: "center", marginTop: SPACING.md },
});
