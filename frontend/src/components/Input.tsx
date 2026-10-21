import React, { useState } from "react";
import { View, Text, TextInput, StyleSheet, TextInputProps, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "@/src/lib/theme";

type Props = TextInputProps & { label?: string; error?: string | null; testID?: string };

export function Input({ label, error, style, testID, secureTextEntry, ...rest }: Props) {
  // Password fields get an eye button to show / hide what you typed.
  const [hidden, setHidden] = useState(true);
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View>
        <TextInput
          testID={testID}
          placeholderTextColor={COLORS.muted}
          secureTextEntry={secureTextEntry ? hidden : false}
          style={[styles.input, secureTextEntry ? { paddingRight: 50 } : null, error ? { borderColor: COLORS.error } : null, style]}
          {...rest}
        />
        {secureTextEntry ? (
          <Pressable
            testID={testID ? `${testID}-eye` : undefined}
            onPress={() => setHidden((h) => !h)}
            hitSlop={10}
            style={styles.eye}
          >
            <Ionicons name={hidden ? "eye-off-outline" : "eye-outline"} size={22} color={COLORS.muted} />
          </Pressable>
        ) : null}
      </View>
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
  eye: { position: "absolute", right: 0, top: 0, bottom: 0, width: 50, alignItems: "center", justifyContent: "center" },
  err: { color: COLORS.error, fontSize: 12 },
});
