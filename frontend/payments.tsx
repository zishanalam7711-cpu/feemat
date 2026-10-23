import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { GradientBg, StatusPill, GradBtn } from "@/src/components/ui";

type Tab = "all" | "paid" | "due";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const niceDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export default function PaymentHistory() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("all");

  const load = useCallback(async () => {
    try {
      let cid = id;
      if (!cid) { const h: any = await api("/student/home"); cid = h?.connection?.id; }
      setData(cid ? await api(`/connections/${cid}`) : null);
    } catch {}
    setLoading(false);
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rows = useMemo(() => {
    if (!data) return [];
    const paid = (data.installments || []).map((i: any) => ({
      key: "p" + i.id, date: i.date, label: niceDate(i.date), amount: i.amount, paid: true, receipt: i.receipt_number, sub: `${i.method || "Payment"} • ${i.month || ""}`,
    }));
    const due = (data.fee_months || []).filter((f: any) => f.due > 0).map((f: any) => ({
      key: "d" + f.id, date: f.month + "-01", label: f.month, amount: f.due, paid: false, receipt: null, sub: "Pending fee",
    }));
    const all = [...paid, ...due].sort((a, b) => (a.date < b.date ? 1 : -1));
    return tab === "paid" ? all.filter((r) => r.paid) : tab === "due" ? all.filter((r) => !r.paid) : all;
  }, [data, tab]);

  return (
    <GradientBg>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={26} color="#fff" /></Pressable>
        <Text style={styles.title}>Payment History</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.panel}>
        <View style={styles.tabs}>
          {(["all", "paid", "due"] as Tab[]).map((k) => (
            <Pressable key={k} onPress={() => setTab(k)} style={[styles.tab, tab === k && styles.tabOn]} testID={`tab-${k}`}>
              <Text style={[styles.tabTxt, tab === k && { color: "#fff" }]}>{k === "all" ? "All" : k === "paid" ? "Paid" : "Due"}</Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color="#1F6BFF" /></View>
        ) : !data ? (
          <View style={styles.center}>
            <Ionicons name="school-outline" size={56} color="#1F6BFF" />
            <Text style={styles.empty}>Connect with a teacher to see your payments.</Text>
            <GradBtn title="Find Teacher" onPress={() => router.push("/student/search" as any)} style={{ alignSelf: "stretch", marginHorizontal: 40, marginTop: 8 }} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor="#1F6BFF" />}
          >
            <View style={styles.card}>
              {rows.length === 0 ? (
                <Text style={styles.empty}>{tab === "due" ? "No pending fees 🎉" : "No payments yet."}</Text>
              ) : rows.map((r, i) => (
                <Pressable
                  key={r.key} disabled={!r.receipt}
                  onPress={() => r.receipt && router.push(`/student/receipt/${r.receipt}` as any)}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.date}>{r.label}</Text>
                    <Text style={styles.sub}>{r.sub}</Text>
                  </View>
                  <Text style={styles.amt}>{inr(r.amount)}</Text>
                  <StatusPill paid={r.paid} />
                </Pressable>
              ))}
            </View>

            <View style={styles.footer}>
              <Ionicons name="school" size={56} color="#1F6BFF" />
              <Text style={styles.foot}>Keep Learning</Text>
              <Text style={styles.foot}>Keep Growing</Text>
            </View>
          </ScrollView>
        )}
      </View>
    </GradientBg>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 14 },
  title: { color: "#fff", fontSize: 18, fontWeight: "800" },
  panel: { flex: 1, backgroundColor: "#F4F8FF", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  tabs: { flexDirection: "row", marginHorizontal: 16, backgroundColor: "#E3EEFF", borderRadius: 14, padding: 4 },
  tab: { flex: 1, height: 40, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: "#1F6BFF" },
  tabTxt: { color: "#475569", fontWeight: "800", fontSize: 14 },
  card: { backgroundColor: "#fff", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: "#EEF2F9" },
  date: { color: "#0F172A", fontWeight: "700", fontSize: 14 },
  sub: { color: "#94A3B8", fontSize: 11, marginTop: 2 },
  amt: { color: "#0F172A", fontWeight: "800", fontSize: 15 },
  empty: { color: "#64748B", textAlign: "center", paddingVertical: 18, fontSize: 13 },
  footer: { alignItems: "center", marginTop: 26, gap: 2 },
  foot: { color: "#1F6BFF", fontWeight: "800", fontSize: 16 },
});
