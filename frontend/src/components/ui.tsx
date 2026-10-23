import React, { useState } from "react";
import { View, Text, Image, Pressable, TextInput, StyleSheet, ActivityIndicator, TextInputProps, ViewStyle, StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { GRAD } from "@/src/lib/theme";

// ---------------- full-screen navy gradient ----------------
export function GradientBg({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient colors={GRAD.bg} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={[{ flex: 1 }, style]}>
      {children}
    </LinearGradient>
  );
}

// ---------------- Feemat logo (+ wordmark and tagline) ----------------
export function Logo({ size = 96, text = true, tagline = true }: { size?: number; text?: boolean; tagline?: boolean }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Image source={require("../../assets/images/icon.png")} style={{ width: size, height: size, borderRadius: size * 0.22 }} resizeMode="contain" />
      {text ? (
        <Text style={[styles.word, { fontSize: Math.max(26, size * 0.36), marginTop: -size * 0.04 }]}>
          <Text style={{ color: "#FFFFFF" }}>Fee</Text>
          <Text style={{ color: "#35C8FF" }}>mat</Text>
        </Text>
      ) : null}
      {tagline ? <Text style={styles.tag}>Manage Fees  •  Build Future</Text> : null}
    </View>
  );
}

// ---------------- gradient button ----------------
export function GradBtn({
  title, onPress, colors = GRAD.primary, icon, loading, disabled, style, testID, height = 50,
}: {
  title: string; onPress: () => void; colors?: readonly [string, string, ...string[]]; icon?: any;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; testID?: string; height?: number;
}) {
  return (
    <Pressable testID={testID} onPress={onPress} disabled={disabled || loading} style={[{ opacity: disabled ? 0.5 : 1 }, style]}>
      <LinearGradient colors={colors as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.btn, { height }]}>
        {loading ? <ActivityIndicator color="#fff" /> : (
          <>
            {icon ? <Ionicons name={icon} size={18} color="#fff" /> : null}
            <Text style={styles.btnTxt}>{title}</Text>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

// ---------------- white input with a left icon (and an eye for passwords) ----------------
type FieldProps = TextInputProps & { icon?: any; secure?: boolean; testID?: string; dark?: boolean };
export function AuthField({ icon, secure, testID, dark, style, ...rest }: FieldProps) {
  const [hidden, setHidden] = useState(true);
  return (
    <View style={[styles.field, dark && styles.fieldDark]}>
      {icon ? <Ionicons name={icon} size={20} color="#64748B" style={{ marginRight: 10 }} /> : null}
      <TextInput
        testID={testID}
        placeholderTextColor="#94A3B8"
        secureTextEntry={secure ? hidden : false}
        style={[styles.fieldInput, style]}
        {...rest}
      />
      {secure ? (
        <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10} testID={testID ? `${testID}-eye` : undefined}>
          <Ionicons name={hidden ? "eye-off-outline" : "eye-outline"} size={21} color="#64748B" />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------- Paid / Due chip ----------------
export function StatusPill({ paid }: { paid: boolean }) {
  return (
    <View style={[styles.pill, { backgroundColor: paid ? "#DCFCE7" : "#FEE2E2" }]}>
      <Text style={[styles.pillTxt, { color: paid ? "#15803D" : "#DC2626" }]}>{paid ? "Paid" : "Due"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  word: { fontWeight: "800", letterSpacing: 0.5 },
  tag: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 4, letterSpacing: 0.5 },
  btn: { borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  btnTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
  field: { flexDirection: "row", alignItems: "center", height: 52, borderRadius: 12, backgroundColor: "#FFFFFF", paddingHorizontal: 14, borderWidth: 1, borderColor: "#DCE6F7" },
  fieldDark: { backgroundColor: "#F4F8FF" },
  fieldInput: { flex: 1, fontSize: 15, color: "#0F172A", height: "100%" },
  pill: { paddingHorizontal: 12, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  pillTxt: { fontSize: 12, fontWeight: "800" },
});
