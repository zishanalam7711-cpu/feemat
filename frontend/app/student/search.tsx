import React, { useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { api } from "@/src/lib/api";
import { Avatar } from "@/src/components/Avatar";

export default function StudentSearch() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const search = async () => {
    const v = q.trim().toUpperCase();
    if (!v) return;
    setErr(null); setBusy(true); setResult(null);
    try {
      const t = await api(`/teachers/${encodeURIComponent(v)}`);
      setResult(t);
    } catch (e: any) {
      setErr("No teacher found with this Teacher ID.");
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Text style={styles.title}>Find your Teacher</Text>
        <Text style={styles.sub}>Ask your teacher for their Teacher ID (e.g. FM-T-10001).</Text>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={COLORS.muted} />
          <TextInput
            testID="teacher-id-input"
            placeholder="Enter Teacher ID"
            placeholderTextColor={COLORS.muted}
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            autoCapitalize="characters"
            onSubmitEditing={search}
          />
          <Pressable testID="teacher-search-btn" onPress={search} style={styles.searchBtn}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Search</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ padding: SPACING.lg }}>
        {busy && <ActivityIndicator color={COLORS.brand} />}
        {err && !busy && (
          <View style={styles.errCard}>
            <Ionicons name="alert-circle" size={24} color={COLORS.error} />
            <Text style={{ color: COLORS.error, fontWeight: "600" }}>{err}</Text>
          </View>
        )}
        {result && (
          <Pressable
            testID="teacher-result-card"
            onPress={() => router.push(`/student/teacher/${result.teacher_id}`)}
            style={styles.card}
          >
            <Avatar name={result.name} uri={result.photo_url} size={56} />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.name}>{result.name}</Text>
                <Ionicons name="checkmark-circle" size={16} color={COLORS.brand} />
              </View>
              <Text style={styles.meta}>{result.teacher_id}</Text>
              <Text style={styles.meta}>{result.coaching_name || "—"}</Text>
              {result.phone ? <Text style={styles.meta}>📞 {result.phone}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider, gap: SPACING.md },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.onSurface },
  sub: { color: COLORS.muted },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, backgroundColor: COLORS.surfaceSecondary, borderRadius: RADIUS.md, paddingLeft: SPACING.md, height: 48 },
  searchInput: { flex: 1, color: COLORS.onSurface, fontSize: 15, letterSpacing: 0.5 },
  searchBtn: { backgroundColor: COLORS.brand, paddingHorizontal: SPACING.lg, height: 48, alignItems: "center", justifyContent: "center", borderTopRightRadius: RADIUS.md, borderBottomRightRadius: RADIUS.md },
  errCard: { flexDirection: "row", alignItems: "center", gap: SPACING.sm, padding: SPACING.md, backgroundColor: "#FEF2F2", borderRadius: RADIUS.md, borderWidth: 1, borderColor: "#FECACA" },
  card: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  name: { fontSize: 16, fontWeight: "800", color: COLORS.onSurface },
  meta: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
});
