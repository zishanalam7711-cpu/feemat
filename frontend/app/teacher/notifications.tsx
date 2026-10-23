import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

const DARK = {
  bg: "#071B45",
  card: "#0E2A63",
  unread: "#143A82",
  border: "rgba(255,255,255,0.08)",
  text: "#FFFFFF",
  sub: "rgba(255,255,255,0.6)",
};

export default function TeacherNotifications() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api("/notifications")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markRead = async (id: string) => {
    try {
      await api(`/notifications/${id}/read`, { method: "POST" });
      setItems((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } catch {}
  };
  const markAll = async () => {
    try {
      await api("/notifications/read-all", { method: "POST" });
      setItems((p) => p.map((n) => ({ ...n, read: true })));
    } catch {}
  };
  const unread = items.filter((n) => !n.read).length;

  return (
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}><Ionicons name="arrow-back" size={22} color="#fff" /></Pressable>
        <Text style={styles.title}>Alerts</Text>
        {unread > 0 && (
          <Pressable onPress={markAll} style={styles.allBtn}>
            <Text style={styles.allTxt}>Mark all read</Text>
          </Pressable>
        )}
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#35A7FF" /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="notifications-off-outline" size={56} color="rgba(255,255,255,0.25)" />
          <Text style={{ color: DARK.sub, marginTop: 8 }}>All caught up!</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: SPACING.md, gap: SPACING.sm, paddingBottom: SPACING.xxl }}
          renderItem={({ item }) => (
            <Pressable onPress={() => markRead(item.id)} style={[styles.row, !item.read && { backgroundColor: DARK.unread }]}>
              <View style={[styles.dot, { backgroundColor: !item.read ? "#35A7FF" : "transparent" }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.t}>{item.title}</Text>
                <Text style={styles.b}>{item.body}</Text>
                <Text style={styles.time}>{new Date(item.created_at).toLocaleString()}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: SPACING.md, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  title: { flex: 1, color: "#fff", fontSize: 22, fontWeight: "800" },
  allBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: "rgba(53,167,255,0.2)" },
  allTxt: { color: "#9CC3FF", fontWeight: "700", fontSize: 12 },
  row: { flexDirection: "row", gap: SPACING.sm, padding: SPACING.md, borderRadius: RADIUS.md, backgroundColor: DARK.card, borderWidth: 1, borderColor: DARK.border },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  t: { color: DARK.text, fontWeight: "700", fontSize: 14 },
  b: { color: DARK.sub, fontSize: 13, marginTop: 2 },
  time: { color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 6 },
});
