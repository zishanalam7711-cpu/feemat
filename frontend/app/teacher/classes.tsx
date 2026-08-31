import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";

type Section = "classes" | "batches" | "subjects";

export default function ClassesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Section>("classes");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api(`/teacher/${tab}`)); } catch {}
    setLoading(false);
  }, [tab]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await api(`/teacher/${tab}`, { method: "POST", body: { name: name.trim() } }); setName(""); await load(); } catch {} finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    try { await api(`/teacher/${tab}/${id}`, { method: "DELETE" }); await load(); } catch {}
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md, marginBottom: SPACING.md }}>
          <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
          <Text style={styles.title}>Classes • Batches • Subjects</Text>
        </View>
        <View style={styles.tabs}>
          {(["classes", "batches", "subjects"] as const).map((t) => (
            <Pressable key={t} testID={`tab-${t}`} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
              <Text style={[styles.tabTxt, tab === t && styles.tabTxtOn]}>{t.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
        <View style={styles.addCard}>
          <Input testID="new-name" label={`Add ${tab.slice(0, -1)}`} value={name} onChangeText={setName} placeholder={tab === "classes" ? "e.g. Class 10" : tab === "batches" ? "e.g. Morning Batch" : "e.g. Mathematics"} />
          <Button testID="add-btn" title={`Add ${tab.slice(0, -1)}`} onPress={add} loading={busy} />
        </View>
        {loading ? <ActivityIndicator color={COLORS.brand} /> : items.length === 0 ? (
          <View style={styles.empty}><Ionicons name="folder-open-outline" size={48} color={COLORS.borderStrong} /><Text style={styles.emptyTxt}>No {tab} yet</Text></View>
        ) : items.map((i) => (
          <View key={i.id} style={styles.row}>
            <Ionicons name={tab === "classes" ? "school" : tab === "batches" ? "people" : "book"} size={20} color={COLORS.brand} />
            <Text style={styles.rowTxt}>{i.name}</Text>
            <Pressable testID={`del-${i.id}`} onPress={() => remove(i.id)} hitSlop={8}><Ionicons name="trash" size={18} color={COLORS.error} /></Pressable>
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  title: { fontSize: 18, fontWeight: "800", color: COLORS.onSurface, flex: 1 },
  tabs: { flexDirection: "row", gap: SPACING.sm },
  tab: { flex: 1, paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSecondary, alignItems: "center" },
  tabOn: { backgroundColor: COLORS.brand },
  tabTxt: { color: COLORS.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  tabTxtOn: { color: "#fff" },
  addCard: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, gap: SPACING.md, borderWidth: 1, borderColor: COLORS.divider },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  rowTxt: { flex: 1, color: COLORS.onSurface, fontWeight: "600" },
  empty: { alignItems: "center", padding: SPACING.xxl, gap: SPACING.md },
  emptyTxt: { color: COLORS.muted },
});
