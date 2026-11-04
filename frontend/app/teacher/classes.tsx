import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, TextInput } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";
import { InlineOverlay } from "@/src/components/InlineOverlay";
import { ClassMembersSheet } from "@/src/components/ClassMembersSheet";

type Section = "classes" | "batches" | "subjects";

export default function ClassesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Section>("classes");
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [members, setMembers] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api(`/teacher/${tab}`)); } catch {}
    setLoading(false);
  }, [tab]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    try { await api(`/teacher/${tab}`, { method: "POST", body: { name: name.trim() } }); setName(""); await load(); }
    catch (e: any) { setErr(e?.message || "Could not add."); }
    setBusy(false);
  };

  const saveEdit = async () => {
    if (!edit || !editName.trim()) return;
    setBusy(true);
    try { await api(`/teacher/${tab}/${edit.id}`, { method: "PUT", body: { name: editName.trim() } }); setEdit(null); await load(); }
    catch (e: any) { Alert.alert("Could not rename", e?.message || ""); }
    setBusy(false);
  };

  const remove = (i: any) => {
    const n = i.student_count || 0;
    const one = tab.slice(0, -1);
    Alert.alert(`Delete ${one}?`, n ? `${i.name} has ${n} student${n === 1 ? "" : "s"}. They will stay in the app, but will no longer be in this ${one}.` : `${i.name} will be deleted.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await api(`/teacher/${tab}/${i.id}?force=true`, { method: "DELETE" }); await load(); } catch (e: any) { Alert.alert("Could not delete", e?.message || ""); }
      } },
    ]);
  };

  const one = tab.slice(0, -1);
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACING.md, marginBottom: SPACING.md }}>
          <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color="#FFFFFF" /></Pressable>
          <Text style={styles.title}>Classes • Batches • Subjects</Text>
        </View>
        <View style={styles.tabs}>
          {(["classes", "batches", "subjects"] as const).map((t) => (
            <Pressable key={t} testID={`tab-${t}`} onPress={() => { setTab(t); setErr(""); }} style={[styles.tab, tab === t && styles.tabOn]}>
              <Text style={[styles.tabTxt, tab === t && styles.tabTxtOn]}>{t.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }} keyboardShouldPersistTaps="handled">
        <View style={styles.addCard}>
          <Input testID="new-name" label={`Add ${one}`} value={name} onChangeText={setName} placeholder={tab === "classes" ? "e.g. Class 10" : tab === "batches" ? "e.g. Morning Batch" : "e.g. Mathematics"} />
          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Button testID="add-btn" title={`Add ${one}`} onPress={add} loading={busy} />
        </View>
        {loading ? <ActivityIndicator color={COLORS.brand} /> : items.length === 0 ? (
          <View style={styles.empty}><Ionicons name="folder-open-outline" size={48} color={COLORS.borderStrong} /><Text style={styles.emptyTxt}>No {tab} yet</Text></View>
        ) : items.map((i) => (
          <View key={i.id} style={styles.row}>
            <Pressable style={styles.rowMain} disabled={tab === "subjects"} onPress={() => setMembers(i)} testID={`open-${i.id}`}>
              <Ionicons name={tab === "classes" ? "school" : tab === "batches" ? "people" : "book"} size={20} color={COLORS.brand} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTxt}>{i.name}</Text>
                {tab !== "subjects" ? <Text style={styles.count}>{i.student_count || 0} student{i.student_count === 1 ? "" : "s"}  •  tap to manage</Text> : null}
              </View>
            </Pressable>
            <Pressable testID={`edit-${i.id}`} onPress={() => { setEdit(i); setEditName(i.name); }} hitSlop={8} style={styles.ic}><Ionicons name="create-outline" size={19} color={COLORS.onSurfaceSecondary} /></Pressable>
            <Pressable testID={`del-${i.id}`} onPress={() => remove(i)} hitSlop={8} style={styles.ic}><Ionicons name="trash" size={18} color={COLORS.error} /></Pressable>
          </View>
        ))}
      </ScrollView>

      <InlineOverlay visible={!!edit} onClose={() => setEdit(null)}>
        <View style={styles.overlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setEdit(null)} />
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.sheetTitle}>Rename {one}</Text>
            <TextInput value={editName} onChangeText={setEditName} autoFocus style={styles.editInput} maxLength={60} />
            <Button title="Save" onPress={saveEdit} loading={busy} />
          </View>
        </View>
      </InlineOverlay>
      <ClassMembersSheet visible={!!members && tab !== "subjects"} kind={tab === "batches" ? "batches" : "classes"} item={members} onClose={() => setMembers(null)} bottomInset={insets.bottom} onChanged={load} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: "#071E4A" },
  title: { fontSize: 18, fontWeight: "800", color: "#FFFFFF", flex: 1 },
  tabs: { flexDirection: "row", gap: SPACING.sm },
  tab: { flex: 1, paddingVertical: 10, borderRadius: RADIUS.md, backgroundColor: COLORS.surfaceSecondary, alignItems: "center" },
  tabOn: { backgroundColor: COLORS.brand },
  tabTxt: { color: COLORS.muted, fontSize: 11, fontWeight: "800", letterSpacing: 0.5 },
  tabTxtOn: { color: "#fff" },
  addCard: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, gap: SPACING.md, borderWidth: 1, borderColor: COLORS.divider },
  err: { color: COLORS.error, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: SPACING.md },
  rowTxt: { color: COLORS.onSurface, fontWeight: "700", fontSize: 15 },
  count: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  ic: { padding: 6 },
  empty: { alignItems: "center", padding: SPACING.xxl, gap: SPACING.md },
  emptyTxt: { color: COLORS.muted },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: "#0F172A" },
  editInput: { backgroundColor: "#F1F5F9", borderRadius: 12, paddingHorizontal: 14, height: 48, fontSize: 16, color: "#0F172A" },
});
