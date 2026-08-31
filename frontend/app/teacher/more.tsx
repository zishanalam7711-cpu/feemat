import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";

const ITEMS: [string, keyof typeof Ionicons.glyphMap, string, string][] = [
  ["Classes & Batches", "school", "Set up classes, batches and subjects", "/teacher/classes"],
  ["Homework", "clipboard", "Assign homework to students", "/teacher/homework"],
  ["Exams & Results", "document-text", "Create exams, record marks", "/teacher/exams"],
  ["Announcements", "megaphone", "Send notices to your students", "/teacher/announcements"],
  ["Reports & Analytics", "bar-chart", "Collections, dues and defaulters", "/teacher/reports"],
  ["Subscription", "rocket", "Upgrade to Pro for unlimited access", "/teacher/subscription"],
];

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surfaceSecondary }}>
      <View style={[styles.header, { paddingTop: insets.top + SPACING.md }]}>
        <Text style={styles.title}>More</Text>
        <Text style={styles.sub}>Grow your coaching with these tools.</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.xxl }}>
        {ITEMS.map(([title, icon, desc, path]) => (
          <Pressable key={path} testID={`more-${path}`} style={styles.row} onPress={() => router.push(path as any)}>
            <View style={styles.iconWrap}><Ionicons name={icon} size={22} color={COLORS.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{title}</Text>
              <Text style={styles.rowDesc}>{desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACING.xl, paddingBottom: SPACING.md, backgroundColor: COLORS.surface, borderBottomWidth: 1, borderBottomColor: COLORS.divider },
  title: { fontSize: 24, fontWeight: "800", color: COLORS.onSurface },
  sub: { color: COLORS.muted, marginTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.md, padding: SPACING.lg, backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.divider },
  iconWrap: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.brandSoft },
  rowTitle: { fontSize: 15, fontWeight: "700", color: COLORS.onSurface },
  rowDesc: { color: COLORS.muted, fontSize: 12, marginTop: 2 },
});
