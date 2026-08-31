import React from "react";
import { View, Text, TextInput, StyleSheet, TextInputProps } from "react-native";
import { COLORS, RADIUS, SPACING } from "@/src/lib/theme";

type Props = TextInputProps & { label?: string; error?: string | null; testID?: string };

export function Input({ label, error, style, testID, ...rest }: Props) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        testID={testID}
        placeholderTextColor={COLORS.muted}
        style={[styles.input, error ? { borderColor: COLORS.error } : null, style]}
        {...rest}
      />
      {error ? <Text style={styles.err}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, color: COLORS.onSurfaceSecondary, fontWeight: "600" },
  input: {
    minHeight: 48,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.lg,
    color: COLORS.onSurface,
    fontSize: 15,
  },
  err: { color: COLORS.error, fontSize: 12 },
});
