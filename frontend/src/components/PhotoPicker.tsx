import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING, RADIUS } from "@/src/lib/theme";
import { Avatar } from "@/src/components/Avatar";

type Props = {
  label: string;
  value?: string | null;
  onChange: (dataUri: string) => void;
  name?: string;
  shape?: "circle" | "square";
  size?: number;
  hint?: string;
};

// Gallery se photo chunta hai, chhota karta hai, aur data-URI bana ke onChange ko deta hai.
export function PhotoPicker({ label, value, onChange, name, shape = "circle", size, hint }: Props) {
  const [busy, setBusy] = useState(false);
  const box = size ?? (shape === "circle" ? 88 : 180);

  const pick = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: shape === "circle",
        aspect: shape === "circle" ? [1, 1] : undefined,
        quality: 1,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      setBusy(true);
      const out = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: shape === "circle" ? 400 : 700 } }],
        { compress: shape === "circle" ? 0.6 : 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (out.base64) onChange(`data:image/jpeg;base64,${out.base64}`);
    } catch (e) {
      Alert.alert("Photo nahi mili", "Dobara try karo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: SPACING.sm }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        <Pressable onPress={pick} style={{ width: box, height: box }}>
          {shape === "circle" ? (
            <Avatar name={name} uri={value} size={box} />
          ) : value ? (
            <Image source={{ uri: value }} style={{ width: box, height: box, borderRadius: RADIUS.md }} contentFit="contain" />
          ) : (
            <View style={[styles.empty, { width: box, height: box }]}>
              <Ionicons name="qr-code-outline" size={44} color={COLORS.muted} />
            </View>
          )}
          <View style={styles.camBadge}>
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="camera" size={14} color="#fff" />}
          </View>
        </Pressable>
        <View style={{ flex: 1, gap: SPACING.sm }}>
          <Pressable onPress={pick} disabled={busy} style={styles.btn}>
            <Ionicons name="image" size={16} color={COLORS.brand} />
            <Text style={styles.btnTxt}>{value ? "Photo badlo" : "Gallery se chuno"}</Text>
          </Pressable>
          {value ? (
            <Pressable onPress={() => onChange("")} style={styles.btnGhost}>
              <Text style={styles.removeTxt}>Hatao</Text>
            </Pressable>
          ) : null}
          <Text style={styles.hint}>{hint || "Photo chuno, phir neeche Save dabao."}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "700", color: COLORS.onSurfaceSecondary },
  row: { flexDirection: "row", alignItems: "center", gap: SPACING.lg },
  empty: { borderRadius: RADIUS.md, borderWidth: 1.5, borderStyle: "dashed", borderColor: COLORS.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.surfaceSecondary },
  camBadge: { position: "absolute", right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.brand, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: COLORS.surface },
  btn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: RADIUS.md, backgroundColor: COLORS.brandSoft },
  btnTxt: { color: COLORS.brand, fontWeight: "700", fontSize: 13 },
  btnGhost: { alignItems: "center", paddingVertical: 4 },
  removeTxt: { color: COLORS.error, fontWeight: "700", fontSize: 13 },
  hint: { color: COLORS.muted, fontSize: 11 },
});
