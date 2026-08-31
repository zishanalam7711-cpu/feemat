import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Input } from "@/src/components/Input";
import { Button } from "@/src/components/Button";

export default function Announcements() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { setLoading(true); try { setItems(await api("/teacher/announcements")); } catch {} setLoading(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try { await api("/teacher/announcements", { method: "POST", body: { title, body, target: "all" } }); setShow(false); setTitle(""); setBody(""); await load(); } catch {} finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="chevron-back" size={26} color={COLORS.onSurface} /></Pressable>
        <Text style={styles.hTitle}>Announcements</Text>
        <Pressable testID="new-ann" onPress={() => setShow(true)} hitSlop={12}><Ionicons name="add-circle" size={26} color={COLORS.brand} /></Pressable>
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View> :
       items.length === 0 ? <View style={styles.center}><Ionicons name="megaphone-outline" size={56} color={COLORS.borderStrong} /><Text style={styles.emptyTxt}>No announcements yet.</Text></View> :
       <ScrollView contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
         {items.map((a) => (
           <View key={a.id} style={styles.card}>
             <Text style={styles.title}>{a.title}</Text>
             <Text style={styles.body}>{a.body}</Text>
             <Text style={styles.meta}>{new Date(a.created_at).toLocaleString()} • To: {a.target}</Text>
           </View>
         ))}
       </ScrollView>}

      <Modal transparent visible={show} animationType="slide" onRequestClose={() => setShow(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Announcement</Text>
            <Input testID="a-title" label="Title" value={title} onChangeText={setTitle} />
            <Input testID="a-body" label="Message" value={body} onChangeText={setBody} multiline style={{ minHeight: 100, textAlignVertical: "top" }} />
            <View style={{ flexDirection: "row", gap: SPACING.md, marginTop: SPACING.md }}>
              <Button title="Cancel" variant="secondary" onPress={() => setShow(false)} style={{ flex: 1 }} />
              <Button testID="a-save" title="Send" onPress={create} loading={busy} style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  hTitle: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  emptyTxt: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  card: { padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider, gap: SPACING.sm },
  title: { fontSize: 15, fontWeight: "800", color: COLORS.onSurface },
  body: { color: COLORS.onSurfaceSecondary, lineHeight: 18 },
  meta: { color: COLORS.muted, fontSize: 11 },
  modalWrap: { flex: 1, backgroundColor: "rgba(15,23,42,0.55)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: COLORS.surface, padding: SPACING.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: SPACING.md, paddingBottom: SPACING.xxl },
  modalTitle: { fontSize: 20, fontWeight: "800", color: COLORS.onSurface, marginBottom: SPACING.sm },
});
