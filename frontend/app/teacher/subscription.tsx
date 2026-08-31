import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Button } from "@/src/components/Button";

export default function Subscription() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [sub, setSub] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"monthly" | "yearly" | null>(null);

  const load = useCallback(async () => { setLoading(true); try { setSub(await api("/teacher/subscription")); } catch {} setLoading(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const upgrade = async (billing: "monthly" | "yearly") => {
    setBusy(billing);
    try { setSub(await api("/teacher/subscription/upgrade", { method: "POST", body: { billing } })); } catch (e: any) {} finally { setBusy(null); }
  };
  const cancel = async () => {
    setBusy("monthly");
    try { setSub(await api("/teacher/subscription/cancel", { method: "POST" })); } catch {} finally { setBusy(null); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>;
  const isPro = sub?.plan === "pro";
  const savings = sub?.pricing?.yearly_savings_inr || 0;

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Pricing</Text>
        <View style={{ width: 26 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.lg, paddingBottom: SPACING.xxl }}>
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Your Plan</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
            <Ionicons name={isPro ? "star" : "flash"} size={18} color={isPro ? "#F59E0B" : COLORS.brand} />
            <Text style={styles.stateVal}>{isPro ? "PRO" : "FREE"}</Text>
            {sub?.status ? <Text style={styles.stateExp}>• {String(sub.status).toUpperCase()}</Text> : null}
            {isPro && sub?.expires_at ? <Text style={styles.stateExp}>till {new Date(sub.expires_at).toLocaleDateString()}</Text> : null}
          </View>
          <Text style={styles.stateSub}>{sub?.active_students} active students {isPro ? "(unlimited)" : `of ${sub?.free_limit}`}</Text>
        </View>

        {/* FREE */}
        <View style={[styles.plan, !isPro && styles.planActive]}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.planName}>Free</Text>
            {!isPro && <View style={styles.badge}><Text style={styles.badgeTxt}>CURRENT</Text></View>}
          </View>
          <Text style={styles.price}>₹0<Text style={styles.priceUnit}> forever</Text></Text>
          <Feature label={`Up to ${sub?.free_limit} active students`} />
          <Feature label="Fees, installments & attendance" />
          <Feature label="Notifications & WhatsApp reminders" />
          <Feature label="Basic reports" />
        </View>

        {/* PRO MONTHLY */}
        <LinearGradient colors={["#7C3AED", "#A855F7"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.planPro}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[styles.planName, { color: "#fff" }]}>Pro Monthly</Text>
            {isPro && sub?.billing === "monthly" && <View style={styles.badgeLight}><Text style={styles.badgeLightTxt}>ACTIVE</Text></View>}
          </View>
          <Text style={[styles.price, { color: "#fff" }]}>{inr(sub?.pricing?.monthly_inr)}<Text style={[styles.priceUnit, { color: "rgba(255,255,255,0.9)" }]}> /month</Text></Text>
          <FeatureLight label="Unlimited students" />
          <FeatureLight label="Automatic monthly fee cycles" />
          <FeatureLight label="Digital receipts, homework, exams" />
          <FeatureLight label="Advanced reports & no ads" />
          <Button
            testID="upgrade-monthly"
            title={isPro && sub?.billing === "monthly" ? "Currently Active" : "Upgrade Monthly"}
            onPress={() => upgrade("monthly")}
            disabled={isPro && sub?.billing === "monthly"}
            loading={busy === "monthly"}
            style={{ marginTop: SPACING.md, backgroundColor: "#fff" }}
          />
        </LinearGradient>

        {/* PRO YEARLY */}
        <LinearGradient colors={["#EC4899", "#7C3AED"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.planPro}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={[styles.planName, { color: "#fff" }]}>Pro Yearly</Text>
            <View style={styles.saveBadge}><Text style={styles.saveTxt}>BEST VALUE • Save ₹589/year</Text></View>
          </View>
          <Text style={[styles.price, { color: "#fff" }]}>{inr(sub?.pricing?.yearly_inr)}<Text style={[styles.priceUnit, { color: "rgba(255,255,255,0.9)" }]}> /year</Text></Text>
          <FeatureLight label="Everything in Pro Monthly" />
          <FeatureLight label={`Save ${inr(savings)} compared to monthly`} />
          <FeatureLight label="Priority support & institute branding" />
          <FeatureLight label="Data export (PDF / CSV)" />
          <Button
            testID="upgrade-yearly"
            title={isPro && sub?.billing === "yearly" ? "Currently Active" : "Upgrade Yearly"}
            onPress={() => upgrade("yearly")}
            disabled={isPro && sub?.billing === "yearly"}
            loading={busy === "yearly"}
            style={{ marginTop: SPACING.md, backgroundColor: "#fff" }}
          />
        </LinearGradient>

        {isPro && (
          <Pressable testID="cancel-sub" onPress={cancel} style={styles.cancelBtn}>
            <Text style={{ color: COLORS.error, fontWeight: "700" }}>Cancel Subscription (back to Free)</Text>
          </Pressable>
        )}
        <Text style={styles.footNote}>Note: upgrades activate immediately for testing. Wire a real payment gateway before production.</Text>
      </ScrollView>
    </View>
  );
}
function Feature({ label }: any) {
  return (
    <View style={styles.featRow}><Ionicons name="checkmark-circle" size={16} color={COLORS.brand} /><Text style={styles.featTxt}>{label}</Text></View>
  );
}
function FeatureLight({ label }: any) {
  return (
    <View style={styles.featRow}><Ionicons name="checkmark-circle" size={16} color="#fff" /><Text style={[styles.featTxt, { color: "#fff" }]}>{label}</Text></View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  stateCard: { backgroundColor: COLORS.surface, padding: SPACING.lg, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  stateTitle: { color: COLORS.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  stateVal: { fontSize: 22, fontWeight: "800", color: COLORS.onSurface },
  stateExp: { color: COLORS.muted, fontSize: 12, marginLeft: 6 },
  stateSub: { color: COLORS.muted, marginTop: 4 },
  plan: { padding: SPACING.lg, borderRadius: RADIUS.lg, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.divider, gap: 6 },
  planActive: { borderColor: COLORS.brand, borderWidth: 2 },
  planPro: { padding: SPACING.lg, borderRadius: RADIUS.lg, gap: 6 },
  planName: { fontSize: 22, fontWeight: "800", color: COLORS.onSurface },
  price: { fontSize: 32, fontWeight: "900", color: COLORS.onSurface, marginTop: 4 },
  priceUnit: { fontSize: 14, fontWeight: "600", color: COLORS.muted },
  featRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  featTxt: { color: COLORS.onSurface, fontSize: 13 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: COLORS.brand },
  badgeTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  badgeLight: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.25)" },
  badgeLightTxt: { color: "#fff", fontSize: 10, fontWeight: "800" },
  saveBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: "#F59E0B" },
  saveTxt: { color: "#fff", fontSize: 9, fontWeight: "800" },
  cancelBtn: { alignItems: "center", padding: SPACING.md },
  footNote: { color: COLORS.muted, fontSize: 11, textAlign: "center", marginTop: SPACING.md },
});
