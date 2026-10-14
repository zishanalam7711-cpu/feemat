import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SPACING, RADIUS, SHADOW } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { useEffect } from "react";

const DARK = {
  bg: "#0B0620",
  bgMid: "#1A0B2E",
  bgSoft: "#150A2E",
  card: "rgba(255,255,255,0.06)",
  cardBorder: "rgba(255,255,255,0.12)",
  textPrimary: "#FFFFFF",
  textSecondary: "rgba(255,255,255,0.65)",
  brand: "#A855F7",
};

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
    <View style={{ flex: 1, backgroundColor: DARK.bg }}>
      <LinearGradient
        colors={[DARK.bg, DARK.bgMid, "#2D1155"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
      />
      <View style={[styles.glow, { top: -60, left: -40, backgroundColor: "#6D28D9" }]} />
      <View style={[styles.glow, { bottom: 40, right: -60, backgroundColor: "#DB2777" }]} />

      <ScrollView
        contentContainerStyle={[
          styles.wrap,
          { paddingTop: insets.top + SPACING.xxl, paddingBottom: insets.bottom + SPACING.xl },
        ]}
      >
        <View style={styles.brandBlock}>
          <View style={styles.logoRing}>
            <View style={styles.logoBox}>
              <Image
                source={require("../assets/images/icon.png")}
                style={{ width: 52, height: 52, borderRadius: 14 }}
                resizeMode="cover"
              />
            </View>
          </View>
          <Text style={styles.brandName} testID="brand-name">
            Fee<Text style={{ color: DARK.brand }}>Mat</Text>
          </Text>
          <Text style={styles.tagline}>Fee & Student Management, done right.</Text>
        </View>

        <View style={{ gap: SPACING.sm, marginTop: SPACING.xxl, alignItems: "center" }}>
          <Text style={styles.subtitle}>
            Welcome to <Text style={{ color: DARK.brand }}>FeeMat</Text>
          </Text>
          <Text style={styles.subhelp}>Select your portal to continue</Text>
        </View>

        <View style={{ gap: SPACING.lg, marginTop: SPACING.xl }}>
          <PortalCard
            testID="teacher-portal-card"
            title="Teacher Portal"
            desc="Manage students, fees & attendance"
            icon="person"
            gradient={["#2563EB", "#1D4ED8"]}
            onPress={() => goto("teacher")}
          />
          <PortalCard
            testID="student-portal-card"
            title="Student Portal"
            desc="View fees, teacher & attendance"
            icon="book"
            gradient={["#DB2777", "#F472B6"]}
            onPress={() => goto("student")}
          />
        </View>

        <View style={styles.footerRow}>
          <View style={styles.footerDot} />
          <Text style={styles.footer}>Built for classrooms & coaching</Text>
          <View style={styles.footerDot} />
        </View>
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
  glow: {
    position: "absolute", width: 220, height: 220, borderRadius: 110, opacity: 0.35,
  },
  brandBlock: { alignItems: "center", gap: SPACING.md },
  logoRing: {
    width: 84, height: 84, borderRadius: 22, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(168,85,247,0.15)", borderWidth: 1, borderColor: "rgba(168,85,247,0.35)",
  },
  logoBox: {
    width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    shadowColor: "#A855F7", shadowOpacity: 0.6, shadowRadius: 20, shadowOffset: { width: 0, height: 0 },
  },
  brandName: { fontSize: 34, fontWeight: "800", color: DARK.textPrimary, letterSpacing: -0.5 },
  tagline: { fontSize: 14, color: DARK.textSecondary },
  subtitle: { fontSize: 24, fontWeight: "800", color: DARK.textPrimary, textAlign: "center" },
  subhelp: { fontSize: 14, color: DARK.textSecondary },
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
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACING.sm, marginTop: SPACING.xxl },
  footerDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: DARK.brand },
  footer: { color: DARK.textSecondary, fontSize: 12 },
});
