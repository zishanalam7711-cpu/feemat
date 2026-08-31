import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";

export default function Notifications() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await api("/notifications")); } catch {}
    setLoading(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markRead = async (id: string) => {
    try { await api(`/notifications/${id}/read`, { method: "POST" }); setItems((p) => p.map((n) => (n.id === id ? { ...n, read: true } : n))); } catch {}
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Text style={styles.title}>Notifications</Text>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="notifications-off-outline" size={56} color={COLORS.borderStrong} />
          <Text style={styles.empty}>All caught up!</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: SPACING.lg, gap: SPACING.sm, paddingBottom: SPACING.xxl }}
          renderItem={({ item }) => (
            <Pressable onPress={() => markRead(item.id)} style={[styles.row, !item.read && styles.rowUnread]}>
              <View style={[styles.dot, { backgroundColor: !item.read ? COLORS.brand : "transparent" }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title2}>{item.title}</Text>
                <Text style={styles.body}>{item.body}</Text>
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
  header: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.onSurface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  empty: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface },
  row: { flexDirection: "row", gap: SPACING.md, padding: SPACING.md, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider, alignItems: "center" },
  rowUnread: { borderColor: COLORS.brand + "55" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title2: { fontSize: 15, fontWeight: "700", color: COLORS.onSurface },
  body: { color: COLORS.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  time: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
});
