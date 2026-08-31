import React from "react";
import { Pressable, Text, StyleSheet, ActivityIndicator, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { COLORS, RADIUS, SPACING } from "@/src/lib/theme";

type Props = {
  title: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
  testID?: string;
  style?: ViewStyle;
  fullWidth?: boolean;
};

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  testID,
  style,
  fullWidth = true,
}: Props) {
  const isDisabled = disabled || loading;
  const bg =
    variant === "primary"
      ? COLORS.brand
      : variant === "secondary"
      ? COLORS.brandSoft
      : variant === "danger"
      ? COLORS.error
      : variant === "success"
      ? COLORS.success
      : "transparent";
  const fg =
    variant === "secondary"
      ? COLORS.brand
      : variant === "ghost"
      ? COLORS.brand
      : COLORS.onBrand;
  return (
    <Pressable
      testID={testID}
      disabled={isDisabled}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: isDisabled ? 0.55 : pressed ? 0.9 : 1 },
        fullWidth && { alignSelf: "stretch" },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.txt, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: 52,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  txt: { fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
});
