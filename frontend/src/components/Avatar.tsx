import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { COLORS, initials } from "@/src/lib/theme";

export function Avatar({
  name,
  uri,
  size = 44,
  bg = COLORS.brandSoft,
  fg = COLORS.brand,
}: {
  name?: string;
  uri?: string | null;
  size?: number;
  bg?: string;
  fg?: string;
}) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
      ]}
    >
      <Text style={{ color: fg, fontWeight: "700", fontSize: Math.round(size * 0.4) }}>
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
});
