import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, TextInput, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform, Alert, ScrollView,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";

const DARK = {
  bg: "#120A28",
  card: "#1E1440",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
  input: "rgba(255,255,255,0.07)",
};
const METHODS = ["Cash", "UPI", "Card", "Bank"];

export default function CollectFees() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [onlyDue, setOnlyDue] = useState(true);
  const [sel, setSel] = useState<any>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res: any = await api(`/teacher/students?filter=${onlyDue ? "due" : "all"}&q=${encodeURIComponent(q)}&limit=200`);
      setItems(res.items || []);
    } catch {}
    setLoading(false);
  }, [q, onlyDue]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [q, onlyDue, load]);

  const totalDue = useMemo(() => items.reduce((a, i) => a + (i.due || 0), 0), [items]);

  const openSheet = (item: any) => {
    setSel(item);
    setAmount(item.due > 0 ? String(Math.round(item.due)) : "");
    setMethod("Cash");
    setNotes("");
  };

  const collect = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { Alert.alert("Amount daalo", "Sahi amount likho."); return; }
    setSaving(true);
    try {
      const res: any = await api(`/connections/${sel.id}/installments`, {
        method: "POST",
        body: { amount: amt, method, notes },
      });
      setSel(null);
      await load();
      router.push(`/teacher/receipt/${res.receipt.receipt_number}` as any);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Payment save nahi hui.");
    }
    setSaving(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <View style={styles.topRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
          <Text style={styles.title}>Collect Fees</Text>
        </View>
        <View style={styles.dueBox}>
          <Text style={styles.dueLbl}>{onlyDue ? "Total Pending" : "Total Due (all listed)"}</Text>
          <Text style={styles.dueVal}>{inr(totalDue)}</Text>
        </View>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={DARK.sub} />
          <TextInput
            value={q} onChangeText={setQ} placeholder="Naam, admission no. ya phone" placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.searchInput}
          />
        </View>
        <View style={styles.chips}>
          <Pressable onPress={() => setOnlyDue(true)} style={[styles.chip, onlyDue && styles.chipOn]}>
            <Text style={[styles.chipTxt, onlyDue && { color: "#fff" }]}>With Due</Text>
          </Pressable>
          <Pressable onPress={() => setOnlyDue(false)} style={[styles.chip, !onlyDue && styles.chipOn]}>
            <Text style={[styles.chipTxt, !onlyDue && { color: "#fff" }]}>All Students</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#A855F7" /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={56} color="rgba(255,255,255,0.25)" />
          <Text style={{ color: DARK.sub, marginTop: 8 }}>{onlyDue ? "Kisi ki fees baaki nahi hai." : "Koi student nahi mila."}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xxl }}
          renderItem={({ item }) => (
            <Pressable onPress={() => openSheet(item)} style={styles.row}>
              <Avatar name={item.student?.name} uri={item.student?.photo_url} size={42} bg="rgba(168,85,247,0.2)" fg="#C4B5FD" />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.student?.name || "Student"}</Text>
                <Text style={styles.meta}>{item.admission_number} • Monthly {inr(item.monthly_fee)}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.amt, { color: item.due > 0 ? "#F87171" : "#34D399" }]}>{item.due > 0 ? inr(item.due) : "Paid"}</Text>
                <Text style={styles.collectTxt}>Collect</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!sel} transparent animationType="slide" onRequestClose={() => setSel(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setSel(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SPACING.lg }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>{sel?.student?.name}</Text>
              <Text style={styles.meta}>{sel?.admission_number} • Baaki: {inr(sel?.due)}</Text>

              <Text style={styles.label}>Amount</Text>
              <TextInput
                value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="₹"
                placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input}
              />
              {sel?.due > 0 && (
                <Pressable onPress={() => setAmount(String(Math.round(sel.due)))}>
                  <Text style={styles.fullLink}>Poori baaki fees ({inr(sel.due)}) bharo</Text>
                </Pressable>
              )}

              <Text style={styles.label}>Payment Method</Text>
              <View style={styles.chips}>
                {METHODS.map((m) => (
                  <Pressable key={m} onPress={() => setMethod(m)} style={[styles.chip, method === m && styles.chipOn]}>
                    <Text style={[styles.chipTxt, method === m && { color: "#fff" }]}>{m}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.label}>Note (optional)</Text>
              <TextInput
                value={notes} onChangeText={setNotes} placeholder="Jaise: March ki fees"
                placeholderTextColor="rgba(255,255,255,0.35)" style={styles.input}
              />

              <Pressable onPress={collect} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]}>
                {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveTxt}>Collect & Receipt Banao</Text>}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  topRow: { flexDirection: "row", alignItems: "center", gap: SPACING.md, marginBottom: SPACING.md },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  dueBox: { padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: "rgba(239,68,68,0.12)", borderWidth: 1, borderColor: "rgba(239,68,68,0.3)", marginBottom: SPACING.md },
  dueLbl: { color: DARK.sub, fontSize: 12 },
  dueVal: { color: "#F87171", fontSize: 26, fontWeight: "800", marginTop: 2 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: DARK.input, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 44 },
  searchInput: { flex: 1, color: "#fff", fontSize: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: SPACING.sm, marginTop: SPACING.sm },
  chip: { height: 34, paddingHorizontal: SPACING.lg, borderRadius: 999, backgroundColor: DARK.input, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: DARK.border },
  chipOn: { backgroundColor: "#7C3AED", borderColor: "#7C3AED" },
  chipTxt: { color: DARK.sub, fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border },
  name: { color: DARK.text, fontWeight: "700", fontSize: 15 },
  meta: { color: DARK.sub, fontSize: 12, marginTop: 2 },
  amt: { fontWeight: "800", fontSize: 15 },
  collectTxt: { color: "#A855F7", fontSize: 12, fontWeight: "700", marginTop: 2 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { backgroundColor: DARK.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: SPACING.lg, maxHeight: "85%" },
  sheetTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  label: { color: DARK.sub, fontSize: 12, fontWeight: "700", marginTop: SPACING.lg, marginBottom: 6, textTransform: "uppercase" },
  input: { height: 48, borderRadius: RADIUS.md, backgroundColor: DARK.input, color: "#fff", paddingHorizontal: SPACING.md, fontSize: 16, borderWidth: 1, borderColor: DARK.border },
  fullLink: { color: "#A855F7", fontWeight: "700", fontSize: 13, marginTop: 8 },
  saveBtn: { height: 52, borderRadius: RADIUS.md, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center", marginTop: SPACING.xl },
  saveTxt: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
