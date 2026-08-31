import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";
import { ProUpgradeModal } from "@/src/components/ProUpgradeModal";

export default function Homework() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [pro, setPro] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [due, setDue] = useState(new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setLoading(true); try { setItems(await api("/teacher/homework")); } catch {} setLoading(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await api("/teacher/homework", { method: "POST", body: { title, description: desc, due_date: due, target: "all" } });
      setShow(false); setTitle(""); setDesc("");
      await load();
    } catch (e: any) {
      if (String(e?.message || "").includes("Upgrade to Pro")) { setShow(false); setPro(true); }
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Homework</Text>
        <Pressable testID="new-hw-btn" onPress={() => setShow(true)} hitSlop={12}><Ionicons name="add-circle" size={26} color={COLORS.brand} /></Pressable>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View> :
        items.length === 0 ? (
          <View style={styles.center}><Ionicons name="clipboard-outline" size={56} color={COLORS.borderStrong} /><Text style={styles.emptyTxt}>No homework yet.</Text><Text style={styles.emptySub}>Assign homework so students see it in their app.</Text></View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
            {items.map((h) => (
              <View key={h.id} style={styles.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Text style={styles.title}>{h.title}</Text>
                  <View style={styles.duePill}><Text style={styles.duePillTxt}>Due {h.due_date}</Text></View>
                </View>
                {h.description ? <Text style={styles.desc}>{h.description}</Text> : null}
                <Text style={styles.meta}>To: {h.target === "all" ? "All students" : h.target}</Text>
              </View>
            ))}
          </ScrollView>
        )}

      <Modal transparent visible={show} animationType="slide" onRequestClose={() => setShow(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Homework</Text>
            <Input testID="hw-title" label="Title" value={title} onChangeText={setTitle} placeholder="Read Chapter 5" />
            <Input testID="hw-desc" label="Description" value={desc} onChangeText={setDesc} multiline />
            <Input testID="hw-due" label="Due Date (YYYY-MM-DD)" value={due} onChangeText={setDue} autoCapitalize="none" />
            <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
              <Button title="Cancel" variant="secondary" onPress={() => setShow(false)} style={{ flex: 1 }} />
              <Button testID="hw-save" title="Assign" onPress={create} loading={busy} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ProUpgradeModal visible={pro} onClose={() => setPro(false)} feature="Homework Assignments" />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  emptyTxt: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  emptySub: { color: COLORS.muted, textAlign: "center" },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider, gap: SPACING.sm },
  title: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, flex: 1 },
  duePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: COLORS.brandSoft },
  duePillTxt: { color: COLORS.brand, fontSize: 11, fontWeight: "700" },
  desc: { color: COLORS.onSurfaceSecondary, lineHeight: 18 },
  meta: { color: COLORS.muted, fontSize: 12 },
  modalWrap: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: COLORS.surface, padding: SPACING.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: SPACING.md, paddingBottom: SPACING.xxl },
  modalTitle: { fontSize: 20, fontWeight: "800", color: COLORS.onSurface, marginBottom: SPACING.sm },
});
