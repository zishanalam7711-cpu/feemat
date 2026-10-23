import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/src/lib/theme";

const tabBar = {
  backgroundColor: "#FFFFFF",
  borderTopWidth: 0,
  height: 66,
  paddingBottom: 8,
  paddingTop: 8,
  borderTopLeftRadius: 22,
  borderTopRightRadius: 22,
  elevation: 14,
  shadowColor: "#0A3A8C",
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: -4 },
} as const;

const HIDDEN = ["notifications", "pay", "teacher/[teacherId]", "fee", "homework", "results", "receipt/[receiptNumber]", "timetable"];

export default function StudentLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.brand,
        tabBarInactiveTintColor: "#94A3B8",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarStyle: tabBar,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} /> }} />
      <Tabs.Screen name="search" options={{ title: "Teacher", tabBarIcon: ({ color, size }) => <Ionicons name="school" size={size} color={color} /> }} />
      <Tabs.Screen name="payments" options={{ title: "Payments", tabBarIcon: ({ color, size }) => <Ionicons name="card" size={size} color={color} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} /> }} />
      {HIDDEN.map((n) => <Tabs.Screen key={n} name={n} options={{ href: null }} />)}
    </Tabs>
  );
}
