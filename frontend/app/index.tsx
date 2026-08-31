import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { COLORS, RADIUS, SPACING, SHADOW } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useEffect } from "react";

export default function PortalChooser() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user?.role === "teacher") router.replace("/teacher");
    else if (user?.role === "student") router.replace("/student");
  }, [user, loading, router]);

  const goto = (role: "teacher" | "student") =>
    router.push({ pathname: "/(auth)/login", params: { role } });

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.surface }}>
      <LinearGradient
        colors={["#EDE9FE", "#FBCFE8", "#DBEAFE"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <ScrollView
        contentContainerStyle={[
          styles.wrap,
          { paddingTop: insets.top + SPACING.xxl, paddingBottom: insets.bottom + SPACING.xl },
        ]}
      >
        <View style={styles.brandBlock}>
          <View style={styles.logo}>
            <Ionicons name="school" size={32} color={COLORS.onBrand} />
          </View>
          <Text style={styles.brandName} testID="brand-name">FeeMat</Text>
          <Text style={styles.tagline}>Fee & Student Management, done right.</Text>
        </View>

        <View style={{ gap: SPACING.lg, marginTop: SPACING.xxl }}>
          <Text style={styles.subtitle}>Welcome to FeeMat</Text>
          <Text style={styles.subhelp}>Select your portal to continue</Text>
        </View>

        <View style={{ gap: SPACING.lg, marginTop: SPACING.xl }}>
          <PortalCard
            testID="teacher-portal-card"
            title="Teacher Portal"
            desc="Manage students, fees & attendance"
            icon="person"
            gradient={["#7C3AED", "#A855F7"]}
            onPress={() => goto("teacher")}
          />
          <PortalCard
            testID="student-portal-card"
            title="Student Portal"
            desc="View fees, teacher & attendance"
            icon="book"
            gradient={["#EC4899", "#F472B6"]}
            onPress={() => goto("student")}
          />
        </View>

        <Text style={styles.footer}>Purple-powered • Built for classrooms & coaching</Text>
      </ScrollView>
    </View>
  );
}

function PortalCard({
  title,
  desc,
  icon,
  gradient,
  onPress,
  testID,
}: {
  title: string;
  desc: string;
  icon: any;
  gradient: [string, string];
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
      <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, SHADOW.card]}>
        <View style={styles.iconCircle}>
          <Ionicons name={icon} size={28} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardDesc}>{desc}</Text>
        </View>
        <Ionicons name="arrow-forward-circle" size={30} color="rgba(255,255,255,0.9)" />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SPACING.xl, flexGrow: 1 },
  brandBlock: { alignItems: "flex-start", gap: SPACING.md },
  logo: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: COLORS.brand,
    alignItems: "center", justifyContent: "center",
    shadowColor: COLORS.brand, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
  },
  brandName: { fontSize: 34, fontWeight: "800", color: COLORS.onSurface, letterSpacing: -0.5 },
  tagline: { fontSize: 15, color: COLORS.onSurfaceSecondary },
  subtitle: { fontSize: 26, fontWeight: "700", color: COLORS.onSurface },
  subhelp: { fontSize: 15, color: COLORS.onSurfaceSecondary },
  card: {
    flexDirection: "row", alignItems: "center", gap: SPACING.lg,
    padding: SPACING.xl, borderRadius: RADIUS.lg, minHeight: 96,
  },
  iconCircle: {
    width: 56, height: 56, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  cardTitle: { fontSize: 20, fontWeight: "700", color: "#fff" },
  cardDesc: { fontSize: 13, color: "rgba(255,255,255,0.9)", marginTop: 2 },
  footer: { textAlign: "center", marginTop: SPACING.xxl, color: COLORS.onSurfaceSecondary, fontSize: 12 },
});
