import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";

type Req = {
  id: string;
  teacher_id: string;
  status: string;
  created_at: string;
  student_snapshot: { name: string; father_name: string; phone: string; class: string; photo_url?: string };
};

export default function RequestsScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api<Req[]>("/requests/incoming");
      setItems(d);
    } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (id: string, action: "accept" | "reject") => {
    setBusyId(id);
    try {
      await api(`/requests/${id}/${action}`, { method: "POST" });
      setItems((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      // swallow; a toast could be added
    } finally {
      setBusyId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Text style={styles.title}>Student Requests</Text>
        <Text style={styles.sub}>Approve or decline join requests.</Text>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="mail-open-outline" size={56} color={COLORS.borderStrong} />
          <Text style={styles.empty}>No pending requests</Text>
          <Text style={styles.emptySub}>Share your Teacher ID with students to receive requests.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xxl }}
          renderItem={({ item }) => (
            <View style={styles.card} testID={`request-card-${item.id}`}>
              <View style={styles.rowTop}>
                <Avatar name={item.student_snapshot.name} uri={item.student_snapshot.photo_url} size={48} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.student_snapshot.name}</Text>
                  <Text style={styles.meta}>Father: {item.student_snapshot.father_name || "—"}</Text>
                  <Text style={styles.meta}>Class: {item.student_snapshot.class || "—"} • {item.student_snapshot.phone || "—"}</Text>
                </View>
              </View>
              <View style={styles.actions}>
                <Pressable
                  testID={`request-reject-${item.id}`}
                  style={[styles.actBtn, styles.reject]}
                  disabled={busyId === item.id}
                  onPress={() => act(item.id, "reject")}
                >
                  <Text style={styles.rejectTxt}>Reject</Text>
                </Pressable>
                <Pressable
                  testID={`request-accept-${item.id}`}
                  style={[styles.actBtn, styles.accept]}
                  disabled={busyId === item.id}
                  onPress={() => act(item.id, "accept")}
                >
                  <Text style={styles.acceptTxt}>Accept</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.onSurface },
  sub: { color: COLORS.muted, marginTop: 4 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  empty: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  emptySub: { color: COLORS.muted, textAlign: "center" },
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, padding: SPACING.lg, gap: SPACING.md, borderWidth: 1, borderColor: COLORS.divider },
  rowTop: { flexDirection: "row", gap: SPACING.md, alignItems: "center" },
  name: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: "row", gap: SPACING.md },
  actBtn: { flex: 1, height: 44, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  accept: { backgroundColor: COLORS.brand },
  reject: { backgroundColor: COLORS.surfaceSecondary, borderWidth: 1, borderColor: COLORS.border },
  acceptTxt: { color: "#fff", fontWeight: "700" },
  rejectTxt: { color: COLORS.onSurface, fontWeight: "700" },
});
