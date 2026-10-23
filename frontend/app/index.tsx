import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GRAD } from "@/src/lib/theme";
import { useAuth } from "@/src/lib/auth";
import { GradientBg, Logo } from "@/src/components/ui";

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user?.role === "teacher") router.replace("/teacher");
    else if (user?.role === "student") router.replace("/student");
  }, [user, loading, router]);

  const go = (role: "teacher" | "student") => router.push({ pathname: "/(auth)/login", params: { role } });

  return (
    <GradientBg>
      <View style={[styles.glow, { top: -60, right: -80 }]} />
      <View style={[styles.glow, { bottom: 120, left: -120, width: 320, height: 320 }]} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24, paddingHorizontal: 22, flexGrow: 1 }}>
        <View style={{ alignItems: "center", marginTop: 8 }}>
          <Logo size={150} />
        </View>

        <View style={{ marginTop: 36 }}>
          <Text style={styles.h1}>Welcome to Feemat</Text>
          <Text style={styles.sub}>Select your portal to continue</Text>
        </View>

        <Pressable testID="portal-teacher" onPress={() => go("teacher")} style={{ marginTop: 22 }}>
          <LinearGradient colors={GRAD.blue} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
            <View style={styles.iconWrap}><Ionicons name="school" size={34} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Teacher Portal</Text>
              <Text style={styles.cardSub}>Manage students, fees and more</Text>
            </View>
            <View style={styles.arrow}><Ionicons name="arrow-forward" size={20} color="#1F6BFF" /></View>
          </LinearGradient>
        </Pressable>

        <Pressable testID="portal-student" onPress={() => go("student")} style={{ marginTop: 16 }}>
          <LinearGradient colors={GRAD.green} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
            <View style={styles.iconWrap}><Ionicons name="person" size={34} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Student Portal</Text>
              <Text style={styles.cardSub}>Track fees, connect with teachers</Text>
            </View>
            <View style={styles.arrow}><Ionicons name="arrow-forward" size={20} color="#16A34A" /></View>
          </LinearGradient>
        </Pressable>

        <View style={{ flex: 1 }} />
        <Text style={styles.footer}>Education  +  Discipline  =  Success</Text>
      </ScrollView>
    </GradientBg>
  );
}

const styles = StyleSheet.create({
  glow: { position: "absolute", width: 260, height: 260, borderRadius: 160, backgroundColor: "rgba(31,107,255,0.16)" },
  h1: { color: "#fff", fontSize: 26, fontWeight: "800" },
  sub: { color: "#35C8FF", fontSize: 14, marginTop: 4 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 18, borderRadius: 20 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.2)", alignItems: "center", justifyContent: "center" },
  cardTitle: { color: "#fff", fontSize: 19, fontWeight: "800" },
  cardSub: { color: "rgba(255,255,255,0.9)", fontSize: 13, marginTop: 3 },
  arrow: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  footer: { color: "rgba(255,255,255,0.7)", textAlign: "center", marginTop: 36, fontSize: 13, letterSpacing: 0.5 },
});
