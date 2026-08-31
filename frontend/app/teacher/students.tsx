import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, TextInput, ScrollView } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS, inr } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";

type Item = {
  id: string;
  admission_number: string;
  monthly_fee: number;
  total_billed: number;
  paid_all: number;
  due: number;
  advance: number;
  active: boolean;
  student: { name?: string; class?: string; phone?: string; photo_url?: string };
};

export default function StudentsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "due" | "paid" | "inactive">("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ items: Item[]; total: number }>(`/teacher/students?q=${encodeURIComponent(q)}&filter=${filter}`);
      setItems(res.items);
    } catch {}
    setLoading(false);
  }, [q, filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Text style={styles.title}>My Students</Text>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={COLORS.muted} />
          <TextInput
            testID="students-search"
            placeholder="Search by name, admission, phone"
            value={q}
            onChangeText={setQ}
            onSubmitEditing={load}
            style={styles.searchInput}
            placeholderTextColor={COLORS.muted}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SPACING.sm, paddingVertical: SPACING.sm }}>
          {(["all", "due", "paid", "inactive"] as const).map((f) => (
            <Pressable key={f} testID={`filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]}>
              <Text style={[styles.chipTxt, filter === f && styles.chipTxtOn]}>{f === "all" ? "All" : f === "due" ? "With Due" : f === "paid" ? "Fully Paid" : "Inactive"}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={COLORS.brand} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={56} color={COLORS.borderStrong} />
          <Text style={styles.empty}>No students yet</Text>
          <Text style={styles.emptySub}>Accept student requests to build your directory.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.md }}
          renderItem={({ item }) => (
            <Pressable
              testID={`student-row-${item.admission_number}`}
              style={[styles.row, item.active === false && { opacity: 0.55 }]}
              onPress={() => router.push(`/teacher/student/${item.id}`)}
            >
              <Avatar name={item.student?.name} uri={item.student?.photo_url} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.student?.name || "Student"}</Text>
                <Text style={styles.rowMeta}>{item.admission_number} • {item.student?.class || "—"}</Text>
                <Text style={styles.rowMeta}>Monthly {inr(item.monthly_fee)} • Billed {inr(item.total_billed)}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={item.due > 0 ? styles.due : styles.paid}>{item.due > 0 ? inr(item.due) : "Paid"}</Text>
                <Text style={styles.rowMeta}>Paid {inr(item.paid_all)}</Text>
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
  title: { fontSize: 24, fontWeight: "800", color: COLORS.onSurface, marginBottom: SPACING.md },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, height: 44 },
  searchInput: { flex: 1, color: COLORS.onSurface, fontSize: 14 },
  chip: { flexShrink: 0, height: 36, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.pill, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: COLORS.border },
  chipOn: { backgroundColor: COLORS.brand, borderColor: COLORS.brand },
  chipTxt: { color: COLORS.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipTxtOn: { color: "#fff" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACING.xl, gap: SPACING.sm },
  empty: { fontSize: 16, fontWeight: "700", color: COLORS.onSurface, marginTop: SPACING.md },
  emptySub: { color: COLORS.muted, textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.md, backgroundColor: COLORS.surface, padding: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  rowName: { fontSize: 15, fontWeight: "700", color: COLORS.onSurface },
  rowMeta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
  due: { color: COLORS.error, fontWeight: "800" },
  paid: { color: COLORS.success, fontWeight: "800" },
});
